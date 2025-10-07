import { routeAuth } from "./auth.js";
import { routeTracks } from "./tracks.js";
import { routePayments } from "./payments.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }), env, request);
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

      return cors(new Response("Not found", { status: 404 }), env, request);
    } catch (e) {
      return cors(json({ ok:false, error: e.message }, 500), env, request);
    }
  }
}

export function json(data, status=200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function cors(res, env, request) {
  const allowed = ["https://www.ergodika.it","https://ergodika.it"];
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
