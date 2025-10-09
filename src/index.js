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
    const maybeAuth = await routeAuth(request, url, env);
    if (maybeAuth) return cors(maybeAuth, env, request);
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

    // (opzionale) health:
    if (request.method === "GET" && (path === "/api" || path === "/api/")) {
      return cors(new Response(JSON.stringify({
        ok: true,
        service: "Ergodika API"
      }), {
        headers: {
          "content-type": "application/json"
        }
      }), env, request);
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
  const allowed = (env.ALLOWED_ORIGINS || "https://www.ergodika.it,https://ergodika.it").split(",").map(s => s.trim()).filter(Boolean);
  const reqOrigin = request?.headers?.get("Origin") || "";
  const origin = allowed.includes(reqOrigin) ? reqOrigin : allowed[0] || "*";
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type,Authorization,Idempotency-Key");
  h.set("Access-Control-Allow-Credentials", "true");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, {
    status: res.status,
    headers: h
  });
}
