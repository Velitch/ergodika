import {
  routeAuth
} from "./auth.js";
import {
  routeTracks
} from "./tracks.js";
import {
  routePayments
} from "./payments.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return cors(json({
        ok: true,
        service: "Ergodika API",
        time: new Date().toISOString()
      }), env, request);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return cors(new Response("OK", {
        status: 200
      }), env, request);
    }

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return cors(new Response(null, {
        status: 204
      }), env, request);
    }
    // Health / Debug
if (request.method === "GET" && url.pathname === "/api/debug-counters") {
  return cors(await debugCounters(env), env, request);
}


    try {
      // Auth
      {
        const r = await routeAuth(request, url, env);
        if (r) return cors(r, env, request);
      }
      // Tracks
      {
        const r = await routeTracks(request, url, env);
        if (r) return cors(r, env, request);
      }
      // Payments
      {
        const r = await routePayments(request, url, env);
        if (r) return cors(r, env, request);
      }

      return cors(new Response("Not found", {
        status: 404
      }), env, request);
    } catch (e) {
      return cors(json({
        ok: false,
        error: e.message
      }, 500), env, request);
    }
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export function cors(res, env, request) {
  const list = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowed = list.length ? list : ["https://www.ergodika.it","https://ergodika.it"];

  const origin = request.headers.get("Origin");
  const okOrigin = allowed.includes(origin) ? origin : allowed[0];

  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", okOrigin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Access-Control-Allow-Credentials", "true");
  return new Response(res.body, { status: res.status, headers });
}

async function debugCounters(env) {
  // Chiavi usate dal vecchio webhook (KV)
  const keys = ["payments:count", "subs:paid"];
  const out = {};
  for (const k of keys) {
    out[k] = await env.ERGODIKA.get(k) || "0";
  }
  return json({ ok: true, counters: out });
}

// src/index.js

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), env);
    }

    try {
      // --- Payments / Connect ---
      if (request.method === "GET" && path === "/api/payments/artist-onboarding") {
        return cors(await artistOnboarding(url, env), env);
      }
      if (request.method === "GET" && path === "/api/payments/artist-status") {
        return cors(await artistStatus(url, env), env);
      }

      // --- Checkout (one-time / subscription) ---
      if (request.method === "POST" && path === "/api/checkout/one-time") {
        const body = await safeJson(request);
        return cors(await checkoutOneTime(body, env), env);
      }
      if (request.method === "POST" && path === "/api/checkout/subscription") {
        const body = await safeJson(request);
        return cors(await checkoutSubscription(body, env), env);
      }

      // --- Convenience: test checkout via GET (redirect diretto a Stripe) ---
      if (request.method === "GET" && path === "/api/checkout/test") {
        return cors(await checkoutTest(url, env), env);
      }

      // --- Stripe webhook (contatori trasparenza) ---
      if (request.method === "POST" && path === "/api/stripe/webhook") {
        const raw = await request.text();
        // NOTE: per semplicità non verifichiamo la firma qui.
        // In prod, verifica 'stripe-signature' con STRIPE_WEBHOOK_SECRET (HMAC SHA256).
        let event;
        try { event = JSON.parse(raw); } catch (e) { event = null; }
        await handleWebhook(event, env);
        return cors(json({ ok: true }), env);
      }

      // --- Debug contatori ---
      if (request.method === "GET" && path === "/api/debug-counters") {
        return cors(await debugCounters(env), env);
      }

      return cors(new Response("Not found", { status: 404 }), env);
    } catch (e) {
      return cors(json({ ok: false, error: e.message }, 500), env);
    }
  }
}

/* =========================
 * Helpers base
 * ========================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function cors(res, env) {
  const allowed = [
    "https://ergodika.it",
    "https://www.ergodika.it",
  ];
  const reqOrigin = res.headers.get("Origin") || allowed[0];
  const origin = allowed.includes(reqOrigin) ? reqOrigin : allowed[0];
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers });
}


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
  const redirect = url.searchParams.get("redirect") || (env.SITE_URL || "https://example.com");
  if (!artistId) return json({ ok: false, error: "artistId required" }, 400);

  const kvKey = `artist:${artistId}:acct`;
  let acct = await env.ERGODIKA.get(kvKey);

  if (!acct) {
    // Creazione account Connect Express con sintassi a parentesi
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

  // Link di onboarding (monouso, breve scadenza)
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

  const success = `${env.SITE_URL || "https://example.com"}/pages/manifesto.html?ok=1`;
  const cancel = `${env.SITE_URL || "https://example.com"}/pages/manifesto.html?canceled=1`;

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
  const priceId = body.priceId;
  const memo = body.memo || "Ergodika subscription";
  if (!priceId) return json({ ok: false, error: "priceId required" }, 400);

  const success = `${env.SITE_URL || "https://example.com"}/pages/members.html?sub=ok`;
  const cancel = `${env.SITE_URL || "https://example.com"}/pages/members.html?sub=cancel`;

  const session = await s(env, "checkout/sessions", "POST", {
    mode: "subscription",
    success_url: success,
    cancel_url: cancel,
    "line_items[0][price]": priceId,
    "metadata[type]": "subscription",
    "subscription_data[metadata][plan]": priceId
  });

  return json({ ok: true, url: session.url });
}

/* =========================
 * Test helper (redirect diretto a Stripe)
 * ========================= */

async function checkoutTest(url, env) {
  const artistId = url.searchParams.get("artistId") || "demo";
  const amount = parseFloat(url.searchParams.get("amount") || "1");
  const memo = url.searchParams.get("memo") || "Ergodika test";

  const amountCents = Math.max(100, Math.floor(amount * 100));

  const acct = await env.ERGODIKA.get(`artist:${artistId}:acct`);
  if (!acct) return json({ ok: false, error: "Artist not onboarded" }, 400);

  const success = `${env.SITE_URL || "https://example.com"}/pages/manifesto.html?ok=1`;
  const cancel = `${env.SITE_URL || "https://example.com"}/pages/manifesto.html?canceled=1`;

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
      // altri eventi ignorati
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
    out[k] = await env.ERGODIKA.get(k) || "0";
  }
  return json(out);
}
