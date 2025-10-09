// src/index.js — Ergodika API router (same-origin under /api)

import { routeAuth } from "./auth.js";
import { routeTracks } from "./tracks.js";
import { routePayments } from "./payments.js";

/* Helpers exported so other modules can import from './index.js' */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function cors(res, env, request) {
  const allowed = (env.ALLOWED_ORIGINS || "https://www.ergodika.it,https://ergodika.it")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const reqOrigin = request?.headers?.get("Origin") || "";
  const origin = allowed.includes(reqOrigin) ? reqOrigin : allowed[0] || "*";

  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key");
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Max-Age", "86400");

  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), env, request);
    }

    // Health for same-origin route (/api and /api/)
    if (request.method === "GET" && (path === "/api" || path === "/api/")) {
      return cors(
        json({ ok: true, service: "Ergodika API", time: new Date().toISOString() }),
        env,
        request
      );
    }

    try {
      // --- Auth routes
      {
        const r = await routeAuth(request, url, env);
        if (r) return cors(r, env, request);
      }

      // --- Tracks routes
      {
        const r = await routeTracks(request, url, env);
        if (r) return cors(r, env, request);
      }

      // --- Payments routes
      {
        const r = await routePayments(request, url, env);
        if (r) return cors(r, env, request);
      }

      // Not found
      return cors(json({ ok: false, error: "Not found" }, 404), env, request);
    } catch (e) {
      return cors(json({ ok: false, error: e.message }, 500), env, request);
    }
  },
};
