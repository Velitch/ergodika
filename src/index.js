// src/index.js
//import { routeAuth }    from "./auth.js";
//import { routeTracks }  from "./tracks.js";
//import { routePayments } from "./payments.js";
//import { routeArtists } from "./artists.js"; // se non l'hai, puoi rimuovere questa riga

// Cloudflare Worker — Ergodika API (Stripe) con CORS multi-origin e contatori KV

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return withCORS(request, new Response(null, { status: 204 }), env);
    }

    // Home “di cortesia”
    if (request.method === "GET" && (path === "/" || path === "/api")) {
      return withCORS(request, json({
        ok: true,
        name: "ergodika-api",
        routes: [
          "GET  /api/payments/artist-onboarding",
          "GET  /api/payments/artist-status",
          "POST /api/checkout/one-time",
          "POST /api/checkout/subscription",
          "GET  /api/checkout/test",
          "GET  /api/billing-portal?customer=cus_xxx&return=/pages/members.html",
          "POST /api/stripe/webhook",
          "GET  /api/debug-counters"
        ]
      }), env);
    }

    try {
      // --- Payments / Connect ---
      if (request.method === "GET" && path === "/api/payments/artist-onboarding") {
        return withCORS(request, await artistOnboarding(url, env), env);
      }
      if (request.method === "GET" && path === "/api/payments/artist-status") {
        return withCORS(request, await artistStatus(url, env), env);
      }

      // --- Checkout (one-time / subscription) ---
      if (request.method === "POST" && path === "/api/checkout/one-time") {
        const body = await safeJson(request);
        return withCORS(request, await checkoutOneTime(body, env), env);
      }
      if (request.method === "POST" && path === "/api/checkout/subscription") {
        const body = await safeJson(request);
        return withCORS(request, await checkoutSubscription(body, env), env);
      }

      // --- Checkout test (redirect diretto)
      if (request.method === "GET" && path === "/api/checkout/test") {
        return withCORS(request, await checkoutTest(url, env), env);
      }

      // --- Billing Portal (gestione abbonamento)
      if (request.method === "GET" && path === "/api/billing-portal") {
        return withCORS(request, await billingPortal(url, env), env);
      }

      // --- Stripe webhook (contatori trasparenza) ---
      if (request.method === "POST" && path === "/api/stripe/webhook") {
        // In produzione: verifica la firma HMAC con STRIPE_WEBHOOK_SECRET
        const raw = await request.text();
        let event;
        try { event = JSON.parse(raw); } catch { event = null; }
        await handleWebhook(event, env);
        return withCORS(request, json({ ok: true }), env);
      }

      // --- Debug contatori ---
      if (request.method === "GET" && path === "/api/debug-counters") {
        return withCORS(request, await debugCounters(env), env);
      }

      return withCORS(request, new Response("Not found", { status: 404 }), env);
    } catch (e) {
      return withCORS(request, json({ ok: false, error: e.message }, 500), env);
    }
  }
};

/* =========================
 * Helpers base
 * ========================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/** CORS multi-origin con preflight e Vary: Origin **/
function parseAllowed(env) {
  const fallback = ["https://www.ergodika.it", "https://ergodika.it"];
  const raw = (env.ALLOWED_ORIGINS || env.SITE_URL || "").trim();
  if (!raw) return fallback;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
function pickOrigin(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = parseAllowed(env);
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0];
}
function withCORS(request, res, env) {
  const origin = pickOrigin(request, env);
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

/** Chiamate Stripe (form-urlencoded) con guardrail su chiave segreta **/
async function s(env, endpoint, method = "POST", form = null) {
  const key = env.STRIPE_SECRET;
  if (!key) throw new Error("Missing STRIPE_SECRET");
  if (!/^sk_/.test(key)) throw new Error("STRIPE_SECRET deve iniziare con 'sk_' (non usare 'pk_...').");

  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
  const body = form ? new URLSearchParams(form).toString() : null;
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, { method, headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe error");
  return data;
}

function fee(amountCents, percent = "20") {
  const p = parseFloat(percent || "20");
  return Math.round((amountCents * p) / 100);
}

async function inc(env, key, delta = 1) {
  const cur = parseInt((await env.ERGODIKA.get(key)) || "0", 10);
  await env.ERGODIKA.put(key, String(cur + delta));
}

/* =========================
 * Connect / Onboarding
 * ========================= */

async function artistOnboarding(url, env) {
  const artistId = url.searchParams.get("artistId");
  const redirect = url.searchParams.get("redirect") || (env.SITE_URL || "https://www.ergodika.it");
  if (!artistId) return json({ ok: false, error: "artistId required" }, 400);

  const kvKey = `artist:${artistId}:acct`;
  let acct = await env.ERGODIKA.get(kvKey);

  if (!acct) {
    const account = await s(env, "accounts", "POST", {
      type: "express",
      country: "IT",
      "capabilities[card_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
      business_type: "individual"
    });
    acct = account.id;
    await env.ERGODIKA.put(kvKey, acct);
  }

  const link = await s(env, "account_links", "POST", {
    account: acct,
    refresh_url: redirect,
    return_url: redirect,
    type: "account_onboarding"
  });

  return json({ ok: true, url: link.url, account_id: acct });
}

async function artistStatus(url, env) {
  const artistId = url.searchParams.get("artistId");
  if (!artistId) return json({ ok: false, error: "artistId required" }, 400);

  const acct = await env.ERGODIKA.get(`artist:${artistId}:acct`);
  if (!acct) {
    return json({ ok: true, account_id: null, details_submitted: false, payouts_enabled: false });
  }
  const account = await s(env, `accounts/${acct}`, "GET");
  return json({
    ok: true,
    account_id: acct,
    details_submitted: !!account.details_submitted,
    payouts_enabled: !!account.payouts_enabled
  });
}

/* =========================
 * Checkout (one-time)
 * ========================= */

async function checkoutOneTime(body, env) {
  const eur = typeof body.amount === "number" ? body.amount : parseFloat(body.amount || "1");
  const amountCents = Math.max(100, Math.floor(eur * 100)); // minimo €1
  const artistId = body.artistId || "unknown";
  const memo = body.memo || "Ergodika support";

  const acct = await env.ERGODIKA.get(`artist:${artistId}:acct`);
  if (!acct) return json({ ok: false, error: "Artist not onboarded" }, 400);

  const success = `${env.SITE_URL}/pages/manifesto.html?ok=1`;
  const cancel  = `${env.SITE_URL}/pages/manifesto.html?canceled=1`;

  const feeAmt = fee(amountCents, env.CONNECT_FEE_PERCENT || "20");

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "payment",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": memo,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": "1",
    "payment_intent_data[application_fee_amount]": String(feeAmt),
    "payment_intent_data[transfer_data][destination]": acct,
    "metadata[artistId]": artistId,
    "metadata[type]": "one_time"
  });

  return json({ ok: true, url: session.url });
}

/* =========================
 * Checkout (subscription)
 * ========================= */

async function checkoutSubscription(body, env) {
  const tier = (body.tier || "").trim();
  const priceId =
    body.priceId ||
    (tier === "3" ? env.STRIPE_PRICE_ID_ERGODIKA_MONTHLY_3 :
     tier === "7" ? env.STRIPE_PRICE_ID_ERGODIKA_MONTHLY_7 :
     null);

  const memo = body.memo || "Ergodika subscription";
  const qty = String(Math.max(1, parseInt(body.quantity || "1", 10))); // default 1

  if (!priceId) return json({ ok: false, error: "priceId or tier required" }, 400);

  const success = `${env.SITE_URL}/pages/members.html?sub=ok`;
  const cancel  = `${env.SITE_URL}/pages/members.html?sub=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "subscription",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": qty,                 // NECESSARIO
    "metadata[type]": "subscription",
    "subscription_data[metadata][plan]": priceId,
    "metadata[memo]": memo
  });

  return json({ ok: true, url: session.url });
}

/* =========================
 * Checkout test (redirect)
 * ========================= */

async function checkoutTest(url, env) {
  const artistId = url.searchParams.get("artistId") || "demo";
  const amount = parseFloat(url.searchParams.get("amount") || "1");
  const memo = url.searchParams.get("memo") || "Ergodika test";

  const amountCents = Math.max(100, Math.floor(amount * 100));
  const acct = await env.ERGODIKA.get(`artist:${artistId}:acct`);
  if (!acct) return json({ ok: false, error: "Artist not onboarded" }, 400);

  const success = `${env.SITE_URL}/pages/manifesto.html?ok=1`;
  const cancel  = `${env.SITE_URL}/pages/manifesto.html?canceled=1`;

  const feeAmt = fee(amountCents, env.CONNECT_FEE_PERCENT || "20");

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "payment",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][product_data][name]": memo,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": "1",
    "payment_intent_data[application_fee_amount]": String(feeAmt),
    "payment_intent_data[transfer_data][destination]": acct,
    "metadata[artistId]": artistId,
    "metadata[type]": "one_time"
  });

  return Response.redirect(session.url, 302);
}

/* =========================
 * Billing portal (gestione abbonamenti)
 * ========================= */

async function billingPortal(url, env) {
  const customer = url.searchParams.get("customer");
  const ret = url.searchParams.get("return") || "/pages/members.html";
  if (!customer) return json({ ok:false, error:"customer required" }, 400);

  const session = await s(env, "billing_portal/sessions", "POST", {
    customer,
    return_url: `${env.SITE_URL}${ret}`
  });
  return Response.redirect(session.url, 302);
}

/* =========================
 * Webhook → aggiorna contatori
 * ========================= */

async function handleWebhook(event, env) {
  if (!event || !event.type) return;
  switch (event.type) {
    case "checkout.session.completed": {
      await inc(env, "payments:count", 1);
      break;
    }
    case "invoice.paid": {
      await inc(env, "subs:paid", 1);
      break;
    }
    default:
      break;
  }
}

/* =========================
 * Debug counters
 * ========================= */

async function debugCounters(env) {
  const keys = ["payments:count", "subs:paid"];
  const out = {};
  for (const k of keys) {
    out[k] = (await env.ERGODIKA.get(k)) || "0";
  }
  return json(out);
}
