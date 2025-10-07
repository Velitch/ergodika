import { json } from "./index.js";

/* ====== Utils ====== */
const ENC = new TextEncoder();
function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64urlStr(str) { return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function utf8(s){ return ENC.encode(s); }
function nowSec(){ return Math.floor(Date.now()/1000); }
function parseCookies(req){
  const raw = req.headers.get("Cookie")||""; const out={};
  raw.split(";").forEach(p=>{ const i=p.indexOf("="); if(i>0) out[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); });
  return out;
}
function cookieSerialize(name, val, opts={}){
  const p=[]; p.push(`${name}=${val}`); if(opts.maxAge)p.push(`Max-Age=${opts.maxAge}`);
  if(opts.expires)p.push(`Expires=${new Date(opts.expires*1000).toUTCString()}`);
  p.push(`Path=${opts.path||"/"}`); if(opts.domain)p.push(`Domain=${opts.domain}`);
  if(opts.httpOnly!==false)p.push("HttpOnly"); if(opts.secure!==false)p.push("Secure");
  p.push(`SameSite=${opts.sameSite||"Lax"}`); return p.join("; ");
}

async function hmacSign(keyBytes, dataStr) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(dataStr));
  return b64url(sig);
}
async function jwtSign(payload, secretB64url, ttlSec) {
  const header = { alg:"HS256", typ:"JWT" };
  const exp = nowSec()+ttlSec;
  const data = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify({...payload,exp}))}`;
  const key = Uint8Array.from(atob(secretB64url.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0));
  const sig = await hmacSign(key, data);
  return `${data}.${sig}`;
}
async function jwtVerify(token, secretB64url){
  const [h,p,s] = token.split("."); if(!h||!p||!s) return null;
  const key = Uint8Array.from(atob(secretB64url.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0));
  const sig = await hmacSign(key, `${h}.${p}`);
  if (sig!==s) return null;
  try { const payload = JSON.parse(atob(p.replace(/-/g,"+").replace(/_/g,"/"))); if(payload.exp && nowSec()>payload.exp) return null; return payload; } catch { return null; }
}

async function hashPassword(password, saltB64, iterations=310000){
  const salt = Uint8Array.from(atob(saltB64), c=>c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt, iterations }, keyMaterial, 256);
  const hash = b64url(bits);
  return { alg:"PBKDF2-SHA256", iter:iterations, salt:saltB64, hash };
}
async function verifyPassword(password, rec){
  if (!rec || rec.alg!=="PBKDF2-SHA256") return false;
  const re = await hashPassword(password, rec.salt, rec.iter);
  return re.hash === rec.hash;
}
function normEmail(e){ return String(e||"").trim().toLowerCase(); }
function newId(n=12){ const a=new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function safeJson(request){ try { return await request.json(); } catch { return {}; } }

/* ====== D1 helpers ====== */
async function d1GetUserByEmail(env, email){
  return env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
}
async function d1GetUserById(env, id){
  return env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first();
}
async function d1GetUserByGoogleSub(env, sub){
  return env.DB.prepare("SELECT * FROM users WHERE google_sub=?").bind(sub).first();
}
async function d1InsertUser(env, user){
  await env.DB.prepare("INSERT INTO users (id,email,password_alg,password_iter,password_salt,password_hash,google_sub,roles,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(user.id,user.email,user.password_alg,user.password_iter,user.password_salt,user.password_hash,user.google_sub,JSON.stringify(user.roles),new Date().toISOString(),new Date().toISOString()).run();
}
async function d1UpdateUserGoogleSub(env, id, sub){
  await env.DB.prepare("UPDATE users SET google_sub=?, updated_at=? WHERE id=?").bind(sub,new Date().toISOString(),id).run();
}
async function d1InsertRefresh(env, userId, jti, exp){
  await env.DB.prepare("INSERT INTO refresh_tokens (id,user_id,jti,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(newId(12), userId, jti, exp, nowSec()).run();
}
async function d1DeleteRefresh(env, userId, jti){
  await env.DB.prepare("DELETE FROM refresh_tokens WHERE user_id=? AND jti=?").bind(userId,jti).run();
}
async function d1HasRefresh(env, userId, jti){
  const r = await env.DB.prepare("SELECT 1 FROM refresh_tokens WHERE user_id=? AND jti=?").bind(userId,jti).first();
  return !!r;
}

/* ====== Public API ====== */
export async function routeAuth(request, url, env){
  const path = url.pathname;

  if (request.method==="POST" && path==="/api/auth/register") {
    const body = await safeJson(request);
    return json(await authRegister(body, env));
  }
  if (request.method==="POST" && path==="/api/auth/login") {
    const body = await safeJson(request);
    return setCookies(await authLogin(body, env));
  }
  if (request.method==="POST" && path==="/api/auth/logout") {
    return setCookies(await authLogout(request, env));
  }
  if (request.method==="GET" && path==="/api/auth/me") {
    return json(await authMe(request, env));
  }
  if (request.method==="POST" && path==="/api/auth/refresh") {
    return setCookies(await authRefresh(request, env));
  }

  // Google OAuth
  if (request.method==="GET" && path==="/api/auth/google/start") {
    return await googleStart(url, env);
  }
  if (request.method==="GET" && path==="/api/auth/google/callback") {
    return setCookies(await googleCallback(url, env));
  }

  return null;
}

/* ====== Auth flows (email/password) ====== */
async function authRegister(body, env){
  const email = normEmail(body.email);
  const password = body.password||"";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok:false, error:"invalid email" };
  if (password.length < 8) return { ok:false, error:"weak password" };
  const exists = await d1GetUserByEmail(env, email);
  if (exists) return { ok:false, error:"email already registered" };

  const saltB64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const pwd = await hashPassword(password, saltB64);
  const user = {
    id:newId(12), email,
    password_alg: pwd.alg, password_iter: pwd.iter, password_salt: pwd.salt, password_hash: pwd.hash,
    google_sub: null, roles:["user"]
  };
  await d1InsertUser(env, user);
  const { setCookies } = await issueSessionCookies(user, env);
  return { ok:true, user:{ id:user.id, email, roles:user.roles }, setCookies };
}

async function authLogin(body, env){
  const email = normEmail(body.email);
  const password = body.password||"";
  const user = await d1GetUserByEmail(env, email);
  if (!user) return { ok:false, error:"invalid credentials" };
  const ok = await verifyPassword(password, { alg:user.password_alg, iter:user.password_iter, salt:user.password_salt, hash:user.password_hash });
  if (!ok) return { ok:false, error:"invalid credentials" };
  const { setCookies } = await issueSessionCookies(user, env);
  return { ok:true, user:{ id:user.id, email:user.email, roles:JSON.parse(user.roles||"[]") }, setCookies };
}

async function authLogout(request, env){
  const cookies = parseCookies(request);
  const refresh = cookies["refresh"]||"";
  if (refresh) {
    const payload = await jwtVerify(refresh, env.AUTH_SECRET);
    if (payload?.sub && payload?.jti) await d1DeleteRefresh(env, payload.sub, payload.jti);
  }
  return { ok:true, setCookies: clearAuthCookies() };
}

async function authMe(request, env){
  const user = await getAuthUser(request, env);
  if (!user) return { ok:false, user:null };
  const { password_alg, password_iter, password_salt, password_hash, ...safe } = user;
  safe.roles = JSON.parse(safe.roles||"[]");
  return { ok:true, user: safe };
}

async function authRefresh(request, env){
  const cookies = parseCookies(request);
  const refresh = cookies["refresh"]||"";
  if (!refresh) return { ok:false, error:"no refresh" };
  const payload = await jwtVerify(refresh, env.AUTH_SECRET);
  if (!payload) return { ok:false, error:"invalid refresh" };
  const alive = await d1HasRefresh(env, payload.sub, payload.jti);
  if (!alive) return { ok:false, error:"revoked refresh" };
  const user = await d1GetUserById(env, payload.sub);
  if (!user) return { ok:false, error:"user not found" };
  await d1DeleteRefresh(env, payload.sub, payload.jti);
  const { setCookies } = await issueSessionCookies(user, env);
  return { ok:true, setCookies };
}

/* ====== Sessions (cookies) ====== */
async function issueSessionCookies(user, env){
  const roles = typeof user.roles==="string" ? JSON.parse(user.roles||"[]") : (user.roles||[]);
  const accessTtl = 15*60;
  const refreshTtl = 30*24*60*60;
  const session = await jwtSign({ sub:user.id, email:user.email, roles }, env.AUTH_SECRET, accessTtl);
  const jti = newId(16);
  const refresh = await jwtSign({ sub:user.id, jti }, env.AUTH_SECRET, refreshTtl);
  const exp = nowSec()+refreshTtl;
  await d1InsertRefresh(env, user.id, jti, exp);
  const setCookies = [
    cookieSerialize("session", session, { maxAge:accessTtl, path:"/", httpOnly:true, secure:true, sameSite:"Lax" }),
    cookieSerialize("refresh", refresh, { maxAge:refreshTtl, path:"/", httpOnly:true, secure:true, sameSite:"Lax" })
  ];
  return { setCookies };
}
function clearAuthCookies(){
  return [
    cookieSerialize("session","",{ maxAge:0, path:"/" }),
    cookieSerialize("refresh","",{ maxAge:0, path:"/" })
  ];
}
export async function getAuthUser(request, env){
  const cookies = parseCookies(request);
  const token = cookies["session"];
  if (!token) return null;
  const payload = await jwtVerify(token, env.AUTH_SECRET);
  if (!payload) return null;
  return await d1GetUserById(env, payload.sub);
}
export async function requireAuth(request, env){
  const u = await getAuthUser(request, env);
  if (!u) return json({ ok:false, error:"unauthorized" }, 401);
  return u;
}
function setCookies(result){
  const headers = {};
  if (result.setCookies) headers["set-cookie"] = result.setCookies.join(", ");
  const { setCookies, ...data } = result;
  return json(data, 200, headers);
}

/* ====== Google OAuth ====== */
async function googleStart(url, env){
  const redirect = url.searchParams.get("redirect") || env.SITE_URL || "/";
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
    access_type: "offline",
    state: btoa(crypto.getRandomValues(new Uint8Array(8)))
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Response.redirect(authUrl, 302);
}

async function googleCallback(url, env){
  const code = url.searchParams.get("code");
  const redirect = url.searchParams.get("redirect") || env.SITE_URL || "/";
  if (!code) return { ok:false, error:"missing code" };

  // Exchange code
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "content-type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "authorization_code", redirect_uri: env.GOOGLE_REDIRECT_URL
    }).toString()
  });
  const tok = await tokenRes.json();
  if (!tokenRes.ok) return { ok:false, error: tok.error_description || "oauth error" };

  // Decode id_token (NOTE: for production validate signature via Google's JWKs)
  const idt = tok.id_token;
  const [, payloadB64] = idt.split(".");
  const payload = JSON.parse(atob(payloadB64.replace(/-/g,"+").replace(/_/g,"/")));
  const email = normEmail(payload.email || "");
  const sub = payload.sub;

  if (!email || !sub) return { ok:false, error:"invalid google profile" };

  let user = await d1GetUserByGoogleSub(env, sub);
  if (!user) {
    // Try link by email
    const byEmail = await d1GetUserByEmail(env, email);
    if (byEmail) {
      await d1UpdateUserGoogleSub(env, byEmail.id, sub);
      user = await d1GetUserById(env, byEmail.id);
    } else {
      // Create new user
      const nu = { id:newId(12), email, google_sub: sub, roles:["user"], password_alg:null, password_iter:null, password_salt:null, password_hash:null };
      await d1InsertUser(env, nu);
      user = await d1GetUserById(env, nu.id);
    }
  }

  const { setCookies } = await issueSessionCookies(user, env);
  return { ok:true, redirect, setCookies };
}
