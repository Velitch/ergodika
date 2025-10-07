// src/index.js
import { routeAuth }    from "./auth.js";
import { routeTracks }  from "./tracks.js";
import { routePayments } from "./payments.js";
import { routeArtists } from "./artists.js"; // se non l'hai, puoi rimuovere questa riga

// ==============================
// Worker
// ==============================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return withCORS(request, new Response(null, { status: 204 }), env);
    }

    // Health / Home
    if (request.method === "GET" && (path === "/" || path === "/api")) {
      return withCORS(request, json({
        ok: true,
        name: "ergodika-api",
        routes: [
          "GET  /health",
          "GET  /api/debug-counters",
          "GET  /api/customers/find?email=",
          "GET  /api/payments/artist-onboarding?artistId=&redirect=",
          "GET  /api/payments/artist-status?artistId=",
          "POST /api/checkout/one-time",
          "POST /api/checkout/subscription",
          "GET  /api/checkout/test?artistId=&amount=&memo=",
          "GET  /api/billing-portal?customer=&return=",
          "POST /api/stripe/webhook"
        ]
      }), env);
    }
    if (request.method === "GET" && path === "/health") {
      return withCORS(request, new Response("OK", { status: 200 }), env);
    }

    try {
      // --- Debug contatori
      if (request.method === "GET" && path === "/api/debug-counters") {
        return withCORS(request, await debugCounters(env), env);
      }

      // --- Customers lookup (per Billing Portal, ecc.)
      if (request.method === "GET" && path === "/api/customers/find") {
        return withCORS(request, await customersFind(url, env), env);
      }

      // --- Auth (email/password + Google OAuth)
      {
        const r = await routeAuth?.(request, url, env);
        if (r) return withCORS(request, r, env);
      }

      // --- Tracks (catalogo brani, se presente)
      {
        const r = await routeTracks?.(request, url, env);
        if (r) return withCORS(request, r, env);
      }

      // --- Payments (subscription + one-time)
      {
        const r = await routePayments?.(request, url, env);
        if (r) return withCORS(request, r, env);
      }

      // --- Artists (CRUD e utilità, se presente)
      {
        const r = await routeArtists?.(request, url, env);
        if (r) return withCORS(request, r, env);
      }

      // --- Stripe Connect: onboarding / status
      if (request.method === "GET" && path === "/api/payments/artist-onboarding") {
        return withCORS(request, await artistOnboarding(url, env), env);
      }
      if (request.method === "GET" && path === "/api/payments/artist-status") {
        return withCORS(request, await artistStatus(url, env), env);
      }

      // --- Checkout test (redirect diretto a Stripe)
      if (request.method === "GET" && path === "/api/checkout/test") {
        return withCORS(request, await checkoutTest(url, env), env);
      }

      // --- Billing Portal (gestione abbonamenti)
      if (request.method === "GET" && path === "/api/billing-portal") {
        return withCORS(request, await billingPortal(url, env), env);
      }

      // --- Stripe webhook (firma verificata + contatori KV)
      if (request.method === "POST" && path === "/api/stripe/webhook") {
        const raw    = await request.text();                  // payload RAW (non .json())
        const sig    = request.headers.get("stripe-signature") || "";
        const secret = env.STRIPE_WEBHOOK_SECRET || "";       // whsec_...

        if (secret) {
          const valid = await verifyStripeSignature(raw, sig, secret);
          if (!valid) return withCORS(request, json({ ok:false, error:"invalid signature" }, 400), env);
        }

        let event; try { event = JSON.parse(raw); } catch { event = null; }
        await handleWebhook(event, env);
        return withCORS(request, json({ ok: true }), env);
      }

      return withCORS(request, new Response("Not found", { status: 404 }), env);
    } catch (e) {
      return withCORS(request, json({ ok: false, error: e.message }, 500), env);
    }
  }
};

// ==============================
// Helpers base
// ==============================
export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/** CORS multi-origin con preflight e credenziali **/
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
  h.set("Access-Control-Allow-Credentials", "true");
  return new Response(res.body, { status: res.status, headers: h });
}

async function safeJson(request) { try { return await request.json(); } catch { return {}; } }

/** Chiamate Stripe (x-www-form-urlencoded) + guardrail sulla chiave **/
async function s(env, endpoint, method = "POST", form = null) {
  const key = env.STRIPE_SECRET;
  if (!key) throw new Error("Missing STRIPE_SECRET");
  if (!/^sk_/.test(key)) throw new Error("STRIPE_SECRET deve iniziare con 'sk_'");

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

async function incKV(env, key, delta = 1) {
  const cur = parseInt((await env.ERGODIKA.get(key)) || "0", 10);
  await env.ERGODIKA.put(key, String(cur + delta));
}

// ==============================
// Stripe Connect: Onboarding / Status
// ==============================
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

// ==============================
// Checkout helpers (test + portal)
// ==============================
async function checkoutTest(url, env) {
  const artistId = url.searchParams.get("artistId") || "demo";
  const amount   = parseFloat(url.searchParams.get("amount") || "1");
  const memo     = url.searchParams.get("memo") || "Ergodika test";

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

// ==============================
// Webhook: incrementa contatori
// ==============================
async function handleWebhook(event, env) {
  if (!event || !event.type) return;
  switch (event.type) {
    case "checkout.session.completed":
      await incKV(env, "payments:count", 1);
      break;
    case "invoice.paid":
      await incKV(env, "subs:paid", 1);
      break;
    default:
      // altri eventi ignorati
      break;
  }
}

// ==============================
// Debug counters
// ==============================
async function debugCounters(env) {
  const out = {
    payments: await env.ERGODIKA.get("payments:count") || "0",
    subs:     await env.ERGODIKA.get("subs:paid") || "0",
  };
  return json({ ok: true, counters: out });
}

// ==============================
// Verifica firma Stripe webhook (HMAC-SHA256)
// ==============================
function parseStripeSigHeader(h) {
  const out = { t: "", v1: [] };
  h.split(",").forEach(part => {
    const [k, v] = part.split("=");
    if (k?.trim() === "t")  out.t = v?.trim();
    if (k?.trim() === "v1") out.v1.push(v?.trim());
  });
  return out;
}
async function hmacSHA256Hex(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function verifyStripeSignature(raw, header, secret) {
  if (!secret || !header) return false;
  const { t, v1 } = parseStripeSigHeader(header);
  if (!t || !v1.length) return false;
  const signedPayload = `${t}.${raw}`;
  const expected = await hmacSHA256Hex(secret, signedPayload);
  return v1.some(s => constantTimeEqual(s, expected));
}
