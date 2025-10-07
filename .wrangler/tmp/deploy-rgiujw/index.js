var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/auth.js
var ENC = new TextEncoder();
var b64url = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64url");
var b64urlStr = /* @__PURE__ */ __name((str) => btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64urlStr");
var b64urlToBytes = /* @__PURE__ */ __name((s2) => {
  const pad = s2.length % 4 ? "=".repeat(4 - s2.length % 4) : "";
  const b64 = s2.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}, "b64urlToBytes");
var utf8 = /* @__PURE__ */ __name((s2) => ENC.encode(s2), "utf8");
var nowSec = /* @__PURE__ */ __name(() => Math.floor(Date.now() / 1e3), "nowSec");
var normEmail = /* @__PURE__ */ __name((e) => String(e || "").trim().toLowerCase(), "normEmail");
var newId = /* @__PURE__ */ __name((n = 12) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}, "newId");
var parseCookies = /* @__PURE__ */ __name((req) => {
  const raw = req.headers.get("Cookie") || "";
  const out = {};
  raw.split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}, "parseCookies");
var cookieSerialize = /* @__PURE__ */ __name((name, val, opts = {}) => {
  const p = [];
  p.push(`${name}=${val}`);
  if (opts.maxAge) p.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) p.push(`Expires=${new Date(opts.expires * 1e3).toUTCString()}`);
  p.push(`Path=${opts.path || "/"}`);
  if (opts.domain) p.push(`Domain=${opts.domain}`);
  if (opts.httpOnly !== false) p.push("HttpOnly");
  if (opts.secure !== false) p.push("Secure");
  p.push(`SameSite=${opts.sameSite || "Lax"}`);
  return p.join("; ");
}, "cookieSerialize");
async function hmacSign(keyBytes, dataStr) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(dataStr));
  return b64url(sig);
}
__name(hmacSign, "hmacSign");
async function jwtSign(payload, secretB64url, ttlSec) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = nowSec() + ttlSec;
  const data = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify({ ...payload, exp }))}`;
  const sig = await hmacSign(b64urlToBytes(secretB64url), data);
  return `${data}.${sig}`;
}
__name(jwtSign, "jwtSign");
async function jwtVerify(token, secretB64url) {
  try {
    const [h, p, s2] = token.split(".");
    if (!h || !p || !s2) return null;
    const sig = await hmacSign(b64urlToBytes(secretB64url), `${h}.${p}`);
    if (sig !== s2) return null;
    const payload = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && nowSec() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
__name(jwtVerify, "jwtVerify");
async function hashPassword(password, saltB64, iterations = 31e4) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, keyMaterial, 256);
  const hash = b64url(bits);
  return { alg: "PBKDF2-SHA256", iter: iterations, salt: saltB64, hash };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, rec) {
  if (!rec || rec.alg !== "PBKDF2-SHA256") return false;
  const re = await hashPassword(password, rec.salt, rec.iter);
  return re.hash === rec.hash;
}
__name(verifyPassword, "verifyPassword");
async function d1GetUserByEmail(env, email) {
  return env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
}
__name(d1GetUserByEmail, "d1GetUserByEmail");
async function d1GetUserById(env, id) {
  return env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
}
__name(d1GetUserById, "d1GetUserById");
async function d1GetUserByGoogleSub(env, sub) {
  return env.DB.prepare("SELECT * FROM users WHERE google_sub=?").bind(sub).first();
}
__name(d1GetUserByGoogleSub, "d1GetUserByGoogleSub");
async function d1InsertUser(env, user) {
  await env.DB.prepare("INSERT INTO users (id,email,password_alg,password_iter,password_salt,password_hash,google_sub,roles,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(
    user.id,
    user.email,
    user.password_alg,
    user.password_iter,
    user.password_salt,
    user.password_hash,
    user.google_sub,
    JSON.stringify(user.roles),
    (/* @__PURE__ */ new Date()).toISOString(),
    (/* @__PURE__ */ new Date()).toISOString()
  ).run();
}
__name(d1InsertUser, "d1InsertUser");
async function d1UpdateUserGoogleSub(env, id, sub) {
  await env.DB.prepare("UPDATE users SET google_sub=?, updated_at=? WHERE id=?").bind(sub, (/* @__PURE__ */ new Date()).toISOString(), id).run();
}
__name(d1UpdateUserGoogleSub, "d1UpdateUserGoogleSub");
async function d1InsertRefresh(env, userId, jti, exp) {
  await env.DB.prepare("INSERT INTO refresh_tokens (id,user_id,jti,expires_at,created_at) VALUES (?,?,?,?,?)").bind(newId(12), userId, jti, exp, nowSec()).run();
}
__name(d1InsertRefresh, "d1InsertRefresh");
async function d1DeleteRefresh(env, userId, jti) {
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id=? AND jti=?").bind(userId, jti).run();
}
__name(d1DeleteRefresh, "d1DeleteRefresh");
async function d1HasRefresh(env, userId, jti) {
  const r = await env.DB.prepare("SELECT 1 FROM refresh_tokens WHERE user_id=? AND jti=?").bind(userId, jti).first();
  return !!r;
}
__name(d1HasRefresh, "d1HasRefresh");
function jsonWithCookies(data, cookies = [], status = 200) {
  const res = json(data, status);
  const h = new Headers(res.headers);
  cookies.forEach((c) => h.append("Set-Cookie", c));
  return new Response(res.body, { status: res.status, headers: h });
}
__name(jsonWithCookies, "jsonWithCookies");
function clearAuthCookies() {
  return [
    cookieSerialize("session", "", { maxAge: 0, path: "/", secure: true, sameSite: "None" }),
    cookieSerialize("refresh", "", { maxAge: 0, path: "/", secure: true, sameSite: "None" })
  ];
}
__name(clearAuthCookies, "clearAuthCookies");
async function routeAuth(request, url, env) {
  const path = url.pathname;
  if (request.method === "POST" && path === "/api/auth/register") {
    const body = await safeJson(request);
    return await authRegister(body, env);
  }
  if (request.method === "POST" && path === "/api/auth/login") {
    const body = await safeJson(request);
    return await authLogin(body, env);
  }
  if (request.method === "POST" && path === "/api/auth/logout") {
    return await authLogout(request, env);
  }
  if (request.method === "GET" && path === "/api/auth/me") {
    return await authMe(request, env);
  }
  if (request.method === "POST" && path === "/api/auth/refresh") {
    return await authRefresh(request, env);
  }
  if (request.method === "GET" && path === "/api/auth/google/start") {
    return await googleStart(url, env);
  }
  if (request.method === "GET" && path === "/api/auth/google/callback") {
    return await googleCallback(url, env);
  }
  return null;
}
__name(routeAuth, "routeAuth");
async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
__name(safeJson, "safeJson");
async function authRegister(body, env) {
  const email = normEmail(body.email);
  const password = body.password || "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "invalid email" }, 400);
  if (password.length < 8) return json({ ok: false, error: "weak password" }, 400);
  const exists = await d1GetUserByEmail(env, email);
  if (exists) return json({ ok: false, error: "email already registered" }, 409);
  const saltB64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const pwd = await hashPassword(password, saltB64);
  const user = {
    id: newId(12),
    email,
    password_alg: pwd.alg,
    password_iter: pwd.iter,
    password_salt: pwd.salt,
    password_hash: pwd.hash,
    google_sub: null,
    roles: ["user"]
  };
  await d1InsertUser(env, user);
  const { cookies: setCookies } = await issueSessionCookies(user, env);
  return jsonWithCookies({ ok: true, user: { id: user.id, email, roles: user.roles } }, setCookies);
}
__name(authRegister, "authRegister");
async function authLogin(body, env) {
  const email = normEmail(body.email);
  const password = body.password || "";
  const user = await d1GetUserByEmail(env, email);
  if (!user) return json({ ok: false, error: "invalid credentials" }, 401);
  const ok = await verifyPassword(password, {
    alg: user.password_alg,
    iter: user.password_iter,
    salt: user.password_salt,
    hash: user.password_hash
  });
  if (!ok) return json({ ok: false, error: "invalid credentials" }, 401);
  const { cookies: setCookies } = await issueSessionCookies(user, env);
  return jsonWithCookies({ ok: true, user: { id: user.id, email: user.email, roles: JSON.parse(user.roles || "[]") } }, setCookies);
}
__name(authLogin, "authLogin");
async function authLogout(request, env) {
  const reqCookies = parseCookies(request);
  const refresh = reqCookies["refresh"] || "";
  if (refresh) {
    const payload = await jwtVerify(refresh, env.AUTH_SECRET);
    if (payload?.sub && payload?.jti) await d1DeleteRefresh(env, payload.sub, payload.jti);
  }
  return jsonWithCookies({ ok: true }, clearAuthCookies());
}
__name(authLogout, "authLogout");
async function authMe(request, env) {
  const user = await getAuthUser(request, env);
  if (!user) return json({ ok: false, user: null });
  const { password_alg, password_iter, password_salt, password_hash, ...safe } = user;
  safe.roles = JSON.parse(safe.roles || "[]");
  return json({ ok: true, user: safe });
}
__name(authMe, "authMe");
async function authRefresh(request, env) {
  const reqCookies = parseCookies(request);
  const refresh = reqCookies["refresh"] || "";
  if (!refresh) return json({ ok: false, error: "no refresh" }, 401);
  const payload = await jwtVerify(refresh, env.AUTH_SECRET);
  if (!payload) return json({ ok: false, error: "invalid refresh" }, 401);
  const alive = await d1HasRefresh(env, payload.sub, payload.jti);
  if (!alive) return json({ ok: false, error: "revoked refresh" }, 401);
  const user = await d1GetUserById(env, payload.sub);
  if (!user) return json({ ok: false, error: "user not found" }, 404);
  await d1DeleteRefresh(env, payload.sub, payload.jti);
  const { cookies: setCookies } = await issueSessionCookies(user, env);
  return jsonWithCookies({ ok: true }, setCookies);
}
__name(authRefresh, "authRefresh");
async function issueSessionCookies(user, env) {
  const roles = typeof user.roles === "string" ? JSON.parse(user.roles || "[]") : user.roles || [];
  const accessTtl = 15 * 60;
  const refreshTtl = 30 * 24 * 60 * 60;
  const session = await jwtSign({ sub: user.id, email: user.email, roles }, env.AUTH_SECRET, accessTtl);
  const jti = newId(16);
  const refresh = await jwtSign({ sub: user.id, jti }, env.AUTH_SECRET, refreshTtl);
  const exp = nowSec() + refreshTtl;
  await d1InsertRefresh(env, user.id, jti, exp);
  const cookies = [
    cookieSerialize("session", session, { maxAge: accessTtl, path: "/", httpOnly: true, secure: true, sameSite: "None" }),
    cookieSerialize("refresh", refresh, { maxAge: refreshTtl, path: "/", httpOnly: true, secure: true, sameSite: "None" })
  ];
  return { cookies };
}
__name(issueSessionCookies, "issueSessionCookies");
async function getAuthUser(request, env) {
  const reqCookies = parseCookies(request);
  const token = reqCookies["session"];
  if (!token) return null;
  const payload = await jwtVerify(token, env.AUTH_SECRET);
  if (!payload) return null;
  return await d1GetUserById(env, payload.sub);
}
__name(getAuthUser, "getAuthUser");
async function googleStart(url, env) {
  const redirect = url.searchParams.get("redirect") || env.SITE_URL || "/";
  const stateObj = { r: redirect, n: b64urlStr(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8)))) };
  const state = btoa(JSON.stringify(stateObj));
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    access_type: "offline",
    state
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Response.redirect(authUrl, 302);
}
__name(googleStart, "googleStart");
async function googleCallback(url, env) {
  if (!env.DB || !env.DB.prepare) {
    return json({ ok: false, error: "D1 binding 'DB' mancante sul Worker" }, 500);
  }
  const code = url.searchParams.get("code");
  let redirect = env.SITE_URL || "/";
  const stateRaw = url.searchParams.get("state");
  if (stateRaw) {
    try {
      const st = JSON.parse(atob(stateRaw));
      if (typeof st?.r === "string") redirect = st.r;
    } catch {
    }
  }
  if (!code) return json({ ok: false, error: "missing code" }, 400);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: env.GOOGLE_REDIRECT_URL
    }).toString()
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) return json({ ok: false, error: tok.error_description || "oauth error" }, 400);
  const idt = tok.id_token || "";
  const [, payloadB64] = idt.split(".");
  let payload;
  try {
    payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    payload = null;
  }
  const email = normEmail(payload?.email || "");
  const sub = payload?.sub;
  if (!email || !sub) return json({ ok: false, error: "invalid google profile" }, 400);
  let user = await d1GetUserByGoogleSub(env, sub);
  if (!user) {
    const byEmail = await d1GetUserByEmail(env, email);
    if (byEmail) {
      await d1UpdateUserGoogleSub(env, byEmail.id, sub);
      user = await d1GetUserById(env, byEmail.id);
    } else {
      const nu = { id: newId(12), email, google_sub: sub, roles: ["user"], password_alg: null, password_iter: null, password_salt: null, password_hash: null };
      await d1InsertUser(env, nu);
      user = await d1GetUserById(env, nu.id);
    }
  }
  const { cookies: setCookies } = await issueSessionCookies(user, env);
  const res = new Response(null, { status: 302, headers: { "Location": redirect } });
  setCookies.forEach((c) => res.headers.append("Set-Cookie", c));
  return res;
}
__name(googleCallback, "googleCallback");

// src/tracks.js
function like(s2) {
  return `%${s2}%`;
}
__name(like, "like");
async function routeTracks(request, url, env) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/tracks/search") {
    return json(await tracksSearch(url, env));
  }
  if (request.method === "GET" && path === "/api/tracks/by-id") {
    return json(await trackById(url, env));
  }
  if (request.method === "GET" && path === "/api/tracks/stream-url") {
    return json(await trackStreamUrl(request, url, env));
  }
  if (request.method === "POST" && path === "/api/plays") {
    const body = await request.json().catch(() => ({}));
    return json(await trackPlay(body, env));
  }
  return null;
}
__name(routeTracks, "routeTracks");
async function tracksSearch(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  const genre = url.searchParams.get("genre") || "";
  const premium = url.searchParams.get("premium") || "";
  let sql = "SELECT t.id,t.title,t.genre,t.is_premium,t.artist_id,a.name AS artist_name,ta.cover_url FROM tracks t JOIN artists a ON a.id=t.artist_id LEFT JOIN track_assets ta ON ta.track_id=t.id WHERE a.deleted_at IS NULL";
  const params = [];
  if (q) {
    sql += " AND (t.title LIKE ? OR a.name LIKE ?)";
    params.push(like(q), like(q));
  }
  if (genre) {
    sql += " AND t.genre=?";
    params.push(genre);
  }
  if (premium === "free") {
    sql += " AND t.is_premium=0";
  }
  if (premium === "premium") {
    sql += " AND t.is_premium=1";
  }
  sql += " ORDER BY t.created_at DESC LIMIT 100";
  const rows = await env.DB.prepare(sql).bind(...params).all();
  return { ok: true, items: rows.results || [] };
}
__name(tracksSearch, "tracksSearch");
async function trackById(url, env) {
  const id = url.searchParams.get("id") || "";
  const row = await env.DB.prepare("SELECT t.*, a.name AS artist_name FROM tracks t JOIN artists a ON a.id=t.artist_id WHERE t.id=?").bind(id).first();
  if (!row) return { ok: false, error: "not found" };
  return { ok: true, track: row };
}
__name(trackById, "trackById");
async function hasAccess(env, userId, trackId) {
  if (!userId) return false;
  const now = Math.floor(Date.now() / 1e3);
  const sub = await env.DB.prepare("SELECT 1 FROM access WHERE user_id=? AND kind='sub' AND (expires_at IS NULL OR expires_at>?)").bind(userId, now).first();
  if (sub) return true;
  const one = await env.DB.prepare("SELECT 1 FROM access WHERE user_id=? AND kind='unlock' AND track_id=? AND (expires_at IS NULL OR expires_at>?)").bind(userId, trackId, now).first();
  return !!one;
}
__name(hasAccess, "hasAccess");
async function trackStreamUrl(request, url, env) {
  const trackId = url.searchParams.get("trackId") || "";
  const asset = await env.DB.prepare("SELECT preview_url, full_url FROM track_assets WHERE track_id=?").bind(trackId).first();
  if (!asset) return { ok: false, error: "no asset" };
  const user = await getAuthUser(request, env);
  const access = await hasAccess(env, user?.id, trackId);
  return { ok: true, url: access ? asset.full_url || asset.preview_url : asset.preview_url };
}
__name(trackStreamUrl, "trackStreamUrl");
async function trackPlay(body, env) {
  const id = crypto.randomUUID();
  const created = Math.floor(Date.now() / 1e3);
  await env.DB.prepare("INSERT INTO plays (id,user_id,track_id,artist_id,milestone,seconds,created_at) VALUES (?,?,?,?,?,?,?)").bind(id, body.userId || null, body.trackId, body.artistId, body.milestone || "start", body.seconds || 0, created).run();
  return { ok: true };
}
__name(trackPlay, "trackPlay");

// src/payments.js
function fee(amountCents, percent = "20") {
  const p = parseFloat(percent || "20");
  return Math.round(amountCents * p / 100);
}
__name(fee, "fee");
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
__name(s, "s");
async function routePayments(request, url, env) {
  const path = url.pathname;
  if (request.method === "POST" && path === "/api/checkout/subscription") {
    const body = await request.json().catch(() => ({}));
    return json(await checkoutSubscription(body, env));
  }
  if (request.method === "POST" && path === "/api/checkout/unlock") {
    const body = await request.json().catch(() => ({}));
    return json(await checkoutUnlock(body, env));
  }
  if (request.method === "POST" && path === "/api/checkout/tip") {
    const body = await request.json().catch(() => ({}));
    return json(await checkoutTip(body, env));
  }
  if (request.method === "GET" && path === "/api/billing-portal") {
    return json(await billingPortal(url, env));
  }
  if (request.method === "POST" && path === "/api/stripe/webhook") {
    const raw = await request.text();
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      event = null;
    }
    await handleWebhook(event, env);
    return json({ ok: true });
  }
  return null;
}
__name(routePayments, "routePayments");
async function checkoutSubscription(body, env) {
  const priceId = body.priceId;
  if (!priceId) return { ok: false, error: "priceId required" };
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
  return { ok: true, url: session.url };
}
__name(checkoutSubscription, "checkoutSubscription");
async function checkoutUnlock(body, env) {
  const trackId = body.trackId;
  const price = Math.max(0.29, parseFloat(body.price || "0.49"));
  const amountCents = Math.round(price * 100);
  if (!trackId) return { ok: false, error: "trackId required" };
  const track = await env.DB.prepare("SELECT artist_id, title FROM tracks WHERE id=?").bind(trackId).first();
  if (!track) return { ok: false, error: "track not found" };
  const artist = await env.DB.prepare("SELECT stripe_account_id, name FROM artists WHERE id=?").bind(track.artist_id).first();
  if (!artist || !artist.stripe_account_id) return { ok: false, error: "artist not onboarded" };
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
  return { ok: true, url: session.url };
}
__name(checkoutUnlock, "checkoutUnlock");
async function checkoutTip(body, env) {
  const artistId = body.artistId;
  const amount = Math.max(1, parseFloat(body.amount || "1.00"));
  const amountCents = Math.round(amount * 100);
  const memo = body.memo || "Tip";
  const artist = await env.DB.prepare("SELECT stripe_account_id, name FROM artists WHERE id=?").bind(artistId).first();
  if (!artist || !artist.stripe_account_id) return { ok: false, error: "artist not onboarded" };
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
  return { ok: true, url: session.url };
}
__name(checkoutTip, "checkoutTip");
async function billingPortal(url, env) {
  const customer = url.searchParams.get("customer");
  const ret = url.searchParams.get("return") || "/";
  if (!customer) return { ok: false, error: "customer required" };
  const base = env.SITE_URL || "https://ergodika.it";
  const return_url = ret.startsWith("/") ? `${base}${ret}` : `${base}/${ret}`;
  const session = await s(env, "billing_portal/sessions", "POST", { customer, return_url });
  return { ok: true, url: session.url };
}
__name(billingPortal, "billingPortal");
async function handleWebhook(event, env) {
  if (!event || !event.type) return;
  switch (event.type) {
    case "checkout.session.completed": {
      const s2 = event.data?.object || {};
      const type = s2.metadata?.type || "";
      if (type === "unlock") {
        const trackId = s2.metadata?.trackId || null;
        const artistId = s2.metadata?.artistId || null;
        const userId = null;
        const expires = null;
        await env.DB.prepare("INSERT INTO access (id,user_id,track_id,kind,expires_at,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), userId, trackId, "unlock", expires, Math.floor(Date.now() / 1e3)).run();
      }
      break;
    }
    default:
      break;
  }
}
__name(handleWebhook, "handleWebhook");

// src/index.js
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return cors(json({
        ok: true,
        service: "Ergodika API",
        time: (/* @__PURE__ */ new Date()).toISOString()
      }), env, request);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return cors(new Response("OK", {
        status: 200
      }), env, request);
    }
    if (request.method === "OPTIONS") {
      return cors(new Response(null, {
        status: 204
      }), env, request);
    }
    try {
      {
        const r = await routeAuth(request, url, env);
        if (r) return cors(r, env, request);
      }
      {
        const r = await routeTracks(request, url, env);
        if (r) return cors(r, env, request);
      }
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
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
__name(json, "json");
function cors(res, env, request) {
  const list = (env.ALLOWED_ORIGINS || "").split(",").map((s2) => s2.trim()).filter(Boolean);
  const allowed = list.length ? list : ["https://www.ergodika.it", "https://ergodika.it"];
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
__name(cors, "cors");
export {
  cors,
  index_default as default,
  json
};
//# sourceMappingURL=index.js.map
