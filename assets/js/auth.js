// src/auth.js — Google OAuth (same-origin /api/*) + sessioni in KV

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function buildCookie(name, value, { maxAge = 60 * 60 * 24 * 30 } = {}) {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",   // same-origin: perfetto
    `Max-Age=${maxAge}`,
  ].join("; ");
}
function clearCookie(name) {
  return [`${name}=`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join("; ");
}
function parseCookies(req) {
  const raw = req.headers.get("Cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}
function rid(len = 24) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map(b => (b % 16).toString(16)).join("");
}

async function kvSet(env, key, val, ttlSec) {
  await env.ERGODIKA.put(key, typeof val === "string" ? val : JSON.stringify(val), {
    expirationTtl: ttlSec,
  });
}
async function kvGet(env, key) {
  const v = await env.ERGODIKA.get(key);
  try { return v ? JSON.parse(v) : null; } catch { return v; }
}
async function kvDel(env, key) {
  await env.ERGODIKA.delete(key);
}

/* =========================
 * HANDLERS
 * ========================= */

async function handleStart(request, url, env) {
  const redirect = url.searchParams.get("redirect") || "/pages/account.html";
  const nonce = rid(12);

  // salviamo il nonce in un cookie temporaneo per validare lo state
  const oauthCookie = buildCookie("erg_oauth", nonce, { maxAge: 600 }); // 10 minuti

  // state = base64({ r: redirect, n: nonce })
  const state = btoa(JSON.stringify({ r: redirect, n: nonce }));

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    access_type: "online",
    include_granted_scopes: "true",
    state,
    prompt: "consent"
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": oauthCookie,
      "Location": authUrl,
    },
  });
}

async function handleCallback(request, url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return json({ ok: false, error: "Missing code/state" }, 400);

  // valida nonce
  const cookies = parseCookies(request);
  const nonceCookie = cookies["erg_oauth"] || "";
  let wanted = { r: "/pages/account.html", n: "" };
  try { wanted = JSON.parse(atob(state)); } catch {}
  if (!wanted.n || nonceCookie !== wanted.n) {
    return json({ ok: false, error: "Invalid state" }, 400);
  }

  // scambia il code con i token
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || tokenJson.error) {
    return json({ ok: false, error: tokenJson.error_description || "Token exchange failed" }, 400);
  }
  const accessToken = tokenJson.access_token;

  // profilo utente
  const uiRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const ui = await uiRes.json();
  if (!uiRes.ok || !ui.sub) {
    return json({ ok: false, error: "Userinfo failed" }, 400);
  }

  // costruisci/aggiorna utente (qui demo = solo KV; se usi D1, sostituisci)
  const userId = ("u_" + ui.sub).slice(0, 24);
  const user = {
    id: userId,
    email: ui.email || null,
    google_sub: ui.sub,
    roles: ["user"],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name: ui.name || null,
    picture: ui.picture || null,
  };
  await kvSet(env, `user:${user.id}`, user, 60 * 60 * 24 * 365);

  // sessione
  const sid = "s_" + rid(16);
  await kvSet(env, `sess:${sid}`, { userId: user.id }, 60 * 60 * 24 * 30); // 30 giorni
  const sessionCookie = buildCookie("erg_sess", sid, { maxAge: 60 * 60 * 24 * 30 });
  const clearOauth = clearCookie("erg_oauth");

  // redirect alla destinazione richiesta
  const dest = (wanted.r && wanted.r.startsWith("/")) ? wanted.r : "/pages/account.html";
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": `${sessionCookie}\n${clearOauth}`,
      "Location": `https://www.ergodika.it${dest}`,
    },
  });
}

async function handleMe(request, env) {
  const cookies = parseCookies(request);
  const sid = cookies["erg_sess"];
  if (!sid) return json({ ok: true, user: null });

  const sess = await kvGet(env, `sess:${sid}`);
  if (!sess?.userId) return json({ ok: true, user: null });

  const user = await kvGet(env, `user:${sess.userId}`);
  return json({ ok: true, user: user || null });
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request);
  const sid = cookies["erg_sess"];
  if (sid) await kvDel(env, `sess:${sid}`);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "Set-Cookie": clearCookie("erg_sess"),
    },
  });
}

/* =========================
 * ROUTER
 * ========================= */
export async function routeAuth(request, url, env) {
  const p = url.pathname;

  if (request.method === "GET" && p === "/api/auth/google/start") {
    return await handleStart(request, url, env);
  }
  if (request.method === "GET" && p === "/api/auth/google/callback") {
    return await handleCallback(request, url, env);
  }
  if (request.method === "GET" && p === "/api/auth/me") {
    return await handleMe(request, env);
  }
  if (request.method === "POST" && p === "/api/auth/logout") {
    return await handleLogout(request, env);
  }

  return null; // non è una rotta auth
}
