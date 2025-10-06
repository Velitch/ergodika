import { json } from "./index.js";

function fee(amountCents, percent = "20") {
  const p = parseFloat(percent || "20");
  return Math.round((amountCents * p) / 100);
}
async function s(env, endpoint, method = "POST", form = null) {
  const headers = {
    "Authorization": `Bearer ${env.STRIPE_SECRET}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
  const body = form ? new URLSearchParams(form).toString() : null;
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, { method, headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe error");
  return data;
}

export async function routePayments(request, url, env){
  const path = url.pathname;

  if (request.method==="POST" && path==="/api/checkout/subscription") {
    const body = await request.json().catch(()=>({}));
    return json(await checkoutSubscription(body, env));
  }
  if (request.method==="POST" && path==="/api/checkout/unlock") {
    const body = await request.json().catch(()=>({}));
    return json(await checkoutUnlock(body, env));
  }
  if (request.method==="POST" && path==="/api/checkout/tip") {
    const body = await request.json().catch(()=>({}));
    return json(await checkoutTip(body, env));
  }
  if (request.method==="GET" && path==="/api/billing-portal") {
    return json(await billingPortal(url, env));
  }
  if (request.method==="POST" && path==="/api/stripe/webhook") {
    const raw = await request.text();
    let event; try { event = JSON.parse(raw); } catch { event = null; }
    await handleWebhook(event, env);
    return json({ ok:true });
  }

  return null;
}

async function checkoutSubscription(body, env){
  const priceId = body.priceId;
  if (!priceId) return { ok:false, error:"priceId required" };

  const success = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?sub=ok`;
  const cancel = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?sub=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "subscription",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[type]": "subscription"
  });

  return { ok:true, url: session.url };
}

async function checkoutUnlock(body, env){
  const trackId = body.trackId;
  const price = Math.max(0.29, parseFloat(body.price||"0.49"));
  const amountCents = Math.round(price * 100);
  if (!trackId) return { ok:false, error:"trackId required" };

  const track = await env.DB.prepare("SELECT artist_id, title FROM tracks WHERE id=?").bind(trackId).first();
  if (!track) return { ok:false, error:"track not found" };

  const artist = await env.DB.prepare("SELECT stripe_account_id, name FROM artists WHERE id=?").bind(track.artist_id).first();
  if (!artist || !artist.stripe_account_id) return { ok:false, error:"artist not onboarded" };

  const feeAmt = fee(amountCents, env.CONNECT_FEE_PERCENT || "20");
  const success = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?unlock=ok`;
  const cancel = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?unlock=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "payment",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": `Sblocco: ${track.title}`,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": "1",
    "payment_intent_data[application_fee_amount]": String(feeAmt),
    "payment_intent_data[transfer_data][destination]": artist.stripe_account_id,
    "metadata[type]": "unlock",
    "metadata[trackId]": trackId,
    "metadata[artistId]": track.artist_id
  });

  return { ok:true, url: session.url };
}

async function checkoutTip(body, env){
  const artistId = body.artistId;
  const amount = Math.max(1, parseFloat(body.amount||"1.00"));
  const amountCents = Math.round(amount * 100);
  const memo = body.memo || "Tip";

  const artist = await env.DB.prepare("SELECT stripe_account_id, name FROM artists WHERE id=?").bind(artistId).first();
  if (!artist || !artist.stripe_account_id) return { ok:false, error:"artist not onboarded" };

  const feeAmt = fee(amountCents, env.CONNECT_FEE_PERCENT || "20");
  const success = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?tip=ok`;
  const cancel = `${env.SITE_URL || "https://ergodika.it"}/pages/tracks.html?tip=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "payment",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": memo,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": "1",
    "payment_intent_data[application_fee_amount]": String(feeAmt),
    "payment_intent_data[transfer_data][destination]": artist.stripe_account_id,
    "metadata[type]": "tip",
    "metadata[artistId]": artistId
  });

  return { ok:true, url: session.url };
}

async function billingPortal(url, env){
  const customer = url.searchParams.get("customer");
  const ret = url.searchParams.get("return") || "/";
  if (!customer) return { ok:false, error:"customer required" };
  const base = env.SITE_URL || "https://ergodika.it";
  const return_url = ret.startsWith("/") ? `${base}${ret}` : `${base}/${ret}`;
  const session = await s(env, "billing_portal/sessions", "POST", { customer, return_url });
  return { ok:true, url: session.url };
}

async function handleWebhook(event, env){
  if (!event || !event.type) return;
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data?.object || {};
      const type = s.metadata?.type || "";
      if (type==="unlock") {
        const trackId = s.metadata?.trackId||null;
        const artistId = s.metadata?.artistId||null;
        const userId = null;
        const expires = null;
        await env.DB.prepare("INSERT INTO access (id,user_id,track_id,kind,expires_at,created_at) VALUES (?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), userId, trackId, "unlock", expires, Math.floor(Date.now()/1000)).run();
      }
      break;
    }
    default: break;
  }
}
