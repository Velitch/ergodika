// src/artists.js
// Minimal, self-contained module for Artists APIs (KV-based MVP)

export async function routeArtists(request, url, env) {
  const path = url.pathname;

  if (request.method === "POST" && path === "/api/artists/register") {
    const body = await safeJson(request);
    return json(await artistRegister(body, env));
  }
  if (request.method === "POST" && path === "/api/artists/update") {
    const body = await safeJson(request);
    return json(await artistUpdate(body, env));
  }
  if (request.method === "GET" && path === "/api/artists/get") {
    return json(await artistGet(url, env));
  }
  if (request.method === "GET" && path === "/api/artists/list") {
    return json(await artistList(env));
  }

  // not matched
  return null;
}

/* ===== Helpers (local, safe to duplicate) ===== */
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

const artistKey = (id) => `artist:${id}`;
const artistsIndexKey = "artists:index";

function slugify(s = "") {
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
function isValidSlug(id) { return /^[a-z0-9-]{3,40}$/.test(id); }
function sanitizeUrl(u = "") {
  if (!u) return "";
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch { return ""; }
}
async function readIndex(env) {
  try { return JSON.parse(await env.ERGODIKA.get(artistsIndexKey) || "[]"); }
  catch { return []; }
}
async function writeIndex(env, ids) {
  await env.ERGODIKA.put(artistsIndexKey, JSON.stringify(ids));
}
function pickArtistPublic(a) {
  if (!a) return null;
  const { token, ...pub } = a;
  return pub;
}
function cryptoRandomHex(n = 24) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ===== Core handlers ===== */
async function artistRegister(body, env) {
  const name = (body.name || "").trim();
  const email = (body.email || "").trim();
  const wantId = (body.artistId || body.slug || name).trim();
  const bio = (body.bio || "").trim();
  const links = {
    website: sanitizeUrl(body.website || ""),
    spotify: sanitizeUrl(body.spotify || ""),
    youtube: sanitizeUrl(body.youtube || ""),
    instagram: sanitizeUrl(body.instagram || "")
  };
  const avatarUrl = sanitizeUrl(body.avatarUrl || "");
  const bannerUrl = sanitizeUrl(body.bannerUrl || "");

  if (name.length < 2) return { ok:false, error:"name too short" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok:false, error:"invalid email" };

  const id = slugify(wantId);
  if (!isValidSlug(id)) return { ok:false, error:"invalid artistId" };

  const exists = await env.ERGODIKA.get(artistKey(id));
  if (exists) return { ok:false, error:"artistId already exists" };

  const token = cryptoRandomHex(24);

  const rec = {
    ok: true,
    artistId: id,
    name, email,
    bio,
    avatarUrl, bannerUrl,
    links,
    stripeAccountId: null,
    createdAt: new Date().toISOString(),
    token
  };

  await env.ERGODIKA.put(artistKey(id), JSON.stringify(rec));

  const idx = await readIndex(env);
  if (!idx.includes(id)) { idx.push(id); await writeIndex(env, idx); }

  return { ok:true, artist: pickArtistPublic(rec), token };
}

async function artistUpdate(body, env) {
  const id = (body.artistId || "").trim();
  const token = (body.token || "").trim();
  if (!isValidSlug(id) || !token) return { ok:false, error:"artistId and token required" };

  const raw = await env.ERGODIKA.get(artistKey(id));
  if (!raw) return { ok:false, error:"not found" };
  const rec = JSON.parse(raw);
  if (rec.token !== token) return { ok:false, error:"forbidden" };

  if (typeof body.name === "string" && body.name.trim().length >= 2) rec.name = body.name.trim();
  if (typeof body.bio === "string") rec.bio = body.bio.trim();
  if (typeof body.avatarUrl === "string") rec.avatarUrl = sanitizeUrl(body.avatarUrl);
  if (typeof body.bannerUrl === "string") rec.bannerUrl = sanitizeUrl(body.bannerUrl);
  rec.links = {
    website: sanitizeUrl(body.website || rec.links?.website || ""),
    spotify: sanitizeUrl(body.spotify || rec.links?.spotify || ""),
    youtube: sanitizeUrl(body.youtube || rec.links?.youtube || ""),
    instagram: sanitizeUrl(body.instagram || rec.links?.instagram || "")
  };

  if (typeof body.stripeAccountId === "string" && /^acct_/.test(body.stripeAccountId)) {
    rec.stripeAccountId = body.stripeAccountId;
  }

  rec.updatedAt = new Date().toISOString();
  await env.ERGODIKA.put(artistKey(id), JSON.stringify(rec));
  return { ok:true, artist: pickArtistPublic(rec) };
}

async function artistGet(url, env) {
  const id = (url.searchParams.get("id") || "").trim();
  if (!isValidSlug(id)) return { ok:false, error:"invalid id" };
  const raw = await env.ERGODIKA.get(artistKey(id));
  if (!raw) return { ok:false, error:"not found" };
  const rec = JSON.parse(raw);

  // fallback: prova vecchio mapping Connect
  if (!rec.stripeAccountId) {
    const acct = await env.ERGODIKA.get(`artist:${id}:acct`);
    if (acct) rec.stripeAccountId = acct;
  }

  return { ok:true, artist: pickArtistPublic(rec) };
}

async function artistList(env) {
  const idx = await readIndex(env);
  const out = [];
  for (const id of idx) {
    const raw = await env.ERGODIKA.get(artistKey(id));
    if (!raw) continue;
    const rec = pickArtistPublic(JSON.parse(raw));
    out.push({ artistId: rec.artistId, name: rec.name, avatarUrl: rec.avatarUrl || "", links: rec.links || {} });
  }
  out.sort((a,b)=> a.name.localeCompare(b.name));
  return { ok:true, artists: out };
}
