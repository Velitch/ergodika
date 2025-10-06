// src/index.js
import { routeArtists } from "./artists.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), env);
    }

    try {
      // --- Artists (register/get/update/list) ---
      {
        const maybeArtist = await routeArtists(request, url, env);
        if (maybeArtist) return cors(maybeArtist, env);
      }

      // --- Customers (lookup by email, per Billing Portal) ---
      if (request.method === "GET" && path === "/api/customers/find") {
        return cors(await customersFind(url, env), env);
      }

      // --- Billing Portal (redirect) ---
      if (request.method === "GET" && path === "/api/billing-portal") {
        return cors(await billingPortal(url, env), env);
      }

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
        let event;
        try { event = JSON.parse(raw); } catch { event = null; }
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
    "https://www.ergodika.it",
    "https://ergodika.it",
  ];
  // Nota: qui leggiamo dall'header della RESPONSE per restare compatibili con la tua implementazione
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
 * Customers / Billing Portal
 * ========================= */

async function customersFind(url, env) {
  const email = (url.searchParams.get("email") || "").trim();
  if (!email) return json({ ok: false, error: "email required" }, 400);
  const res = await s(env, `customers?email=${encodeURIComponent(email)}`, "GET");
  const customer = (res?.data && res.data[0]) || null;
  return json({ ok: true, email, customerId: customer?.id || null });
}

async function billingPortal(url, env) {
  const customer = url.searchParams.get("customer");
  const ret = url.searchParams.get("return") || "/";
  if (!customer) return json({ ok: false, error: "customer required" }, 400);
  const base = env.SITE_URL || "https://example.com";
  const return_url = ret.startsWith("/") ? `${base}${ret}` : `${base}/${ret}`;
  const session = await s(env, "billing_portal/sessions", "POST", {
    customer,
    return_url
  });
  // redirect (Stripe gestisce il portale)
  return Response.redirect(session.url, 302);
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
  const amountCents = Math.max(100, Math.floor(eur * 100));
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
  const priceId = body.priceId || body.tier; // supporto 'tier' già usato dai bottoni
  const memo = body.memo || "Ergodika subscription";
  if (!priceId) return json({ ok: false, error: "priceId required" }, 400);

  const success = `${env.SITE_URL || "https://example.com"}/pages/members.html?sub=ok`;
  const cancel = `${env.SITE_URL || "https://example.com"}/pages/members.html?sub=cancel`;

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
