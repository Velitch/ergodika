// src/payments.js — Stripe (Checkout, Connect, Webhook)
import { json } from "./index.js";

/* ============ Helpers ============ */
const TE = new TextEncoder();

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

async function s(env, endpoint, method = "POST", form = null) {
  const headers = {
    "Authorization": `Bearer ${env.STRIPE_SECRET}`,
    "Content-Type": "application/x-www-form-urlencoded"
  };
  const body = form ? new URLSearchParams(form).toString() : null;
  const res = await fetch(`https://api.stripe.com/v1/${endpoint}`, { method, headers, body });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe error");
  return data;
}

function fee(amountCents, percent = "20") {
  const p = parseFloat(percent || "20");
  return Math.round((amountCents * p) / 100);
}

async function inc(env, key, delta = 1) {
  try {
    const cur = parseInt((await env.ERGODIKA.get(key)) || "0", 10);
    await env.ERGODIKA.put(key, String(cur + delta));
  } catch { /* ignore */ }
}

/* Timing-safe compare for webhook signature */
function timingSafeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey("raw", TE.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, TE.encode(message));
  const bytes = new Uint8Array(sig);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(request, env, raw) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "no secret configured" };
  const sigHeader = request.headers.get("stripe-signature") || "";
  // Stripe format: t=timestamp,v1=signature,...
  const parts = Object.fromEntries(sigHeader.split(",").map(kv => {
    const [k, v] = kv.trim().split("=");
    return [k, v];
  }));
  if (!parts.t || !parts.v1) return { ok: false, reason: "missing parts" };
  const signedPayload = `${parts.t}.${raw}`;
  const expected = await hmacSha256Hex(secret, signedPayload);
  const ok = timingSafeEq(expected, parts.v1);
  return { ok, reason: ok ? "ok" : "mismatch" };
}

/* ============ Routes ============ */
export async function routePayments(request, url, env) {
  const path = url.pathname;

  // --- Checkout (one-time)
  if (request.method === "POST" && path === "/api/checkout/one-time") {
    const body = await safeJson(request);
    return await checkoutOneTime(body, env);
  }

  // --- Checkout (subscription)
  if (request.method === "POST" && path === "/api/checkout/subscription") {
    const body = await safeJson(request);
    return await checkoutSubscription(body, env);
  }

  // --- Connect onboarding
  if (request.method === "GET" && path === "/api/payments/artist-onboarding") {
    return await artistOnboarding(url, env);
  }

  // --- Connect status
  if (request.method === "GET" && path === "/api/payments/artist-status") {
    return await artistStatus(url, env);
  }

  // --- Stripe webhook
  if (request.method === "POST" && path === "/api/stripe/webhook") {
    const raw = await request.text();
    // Optional signature verification
    const v = await verifyStripeSignature(request, env, raw);
    if (env.STRIPE_WEBHOOK_SECRET && !v.ok) {
      return json({ ok: false, error: "invalid signature", reason: v.reason }, 400);
    }
    let event = null;
    try { event = JSON.parse(raw); } catch {}
    await handleWebhook(event, env);
    return json({ ok: true });
  }

  return null;
}

/* ============ Handlers ============ */

async function checkoutOneTime(body, env) {
  const eur = typeof body.amount === "number" ? body.amount : parseFloat(body.amount || "1");
  const amountCents = Math.max(100, Math.floor(eur * 100)); // minimo €1
  const artistId = body.artistId || "unknown";
  const memo = body.memo || "Ergodika support";

  const acct = await env.ERGODIKA.get(`artist:${artistId}:acct`);
  if (!acct) return json({ ok: false, error: "Artist not onboarded" }, 400);

  const success = `${env.SITE_URL || "https://www.ergodika.it"}/pages/manifesto.html?ok=1`;
  const cancel = `${env.SITE_URL || "https://www.ergodika.it"}/pages/manifesto.html?canceled=1`;
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

async function checkoutSubscription(body, env) {
  const priceId = body.priceId || body.tier;
  if (!priceId) return json({ ok: false, error: "priceId required" }, 400);

  const success = `${env.SITE_URL || "https://www.ergodika.it"}/pages/members.html?sub=ok`;
  const cancel = `${env.SITE_URL || "https://www.ergodika.it"}/pages/members.html?sub=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "subscription",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[type]": "subscription",
    "subscription_data[metadata][plan]": priceId
  });

  return json({ ok: true, url: session.url });
}

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
