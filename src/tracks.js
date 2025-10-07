import { json } from "./index.js";
import { getAuthUser } from "./auth.js";

function like(s){ return `%${s}%`; }

export async function routeTracks(request, url, env){
  const path = url.pathname;

  if (request.method==="GET" && path==="/api/tracks/search") {
    return json(await tracksSearch(url, env));
  }
  if (request.method==="GET" && path==="/api/tracks/by-id") {
    return json(await trackById(url, env));
  }
  if (request.method==="GET" && path==="/api/tracks/stream-url") {
    return json(await trackStreamUrl(request, url, env));
  }
  if (request.method==="POST" && path==="/api/plays") {
    const body = await request.json().catch(()=>({}));
    return json(await trackPlay(body, env));
  }

  return null;
}

async function tracksSearch(url, env){
  const q = (url.searchParams.get("q")||"").trim();
  const genre = url.searchParams.get("genre")||"";
  const premium = url.searchParams.get("premium")||"";

  let sql = "SELECT t.id,t.title,t.genre,t.is_premium,t.artist_id,a.name AS artist_name,ta.cover_url FROM tracks t JOIN artists a ON a.id=t.artist_id LEFT JOIN track_assets ta ON ta.track_id=t.id WHERE a.deleted_at IS NULL";
  const params = [];
  if (q) { sql += " AND (t.title LIKE ? OR a.name LIKE ?)"; params.push(like(q), like(q)); }
  if (genre) { sql += " AND t.genre=?"; params.push(genre); }
  if (premium==="free") { sql += " AND t.is_premium=0"; }
  if (premium==="premium") { sql += " AND t.is_premium=1"; }
  sql += " ORDER BY t.created_at DESC LIMIT 100";

  const rows = await env.DB.prepare(sql).bind(...params).all();
  return { ok:true, items: rows.results || [] };
}

async function trackById(url, env){
  const id = url.searchParams.get("id")||"";
  const row = await env.DB.prepare("SELECT t.*, a.name AS artist_name FROM tracks t JOIN artists a ON a.id=t.artist_id WHERE t.id=?").bind(id).first();
  if (!row) return { ok:false, error:"not found" };
  return { ok:true, track: row };
}

async function hasAccess(env, userId, trackId){
  if (!userId) return false;
  // sub access
  const now = Math.floor(Date.now()/1000);
  const sub = await env.DB.prepare("SELECT 1 FROM access WHERE user_id=? AND kind='sub' AND (expires_at IS NULL OR expires_at>?)").bind(userId, now).first();
  if (sub) return true;
  // per-track unlock
  const one = await env.DB.prepare("SELECT 1 FROM access WHERE user_id=? AND kind='unlock' AND track_id=? AND (expires_at IS NULL OR expires_at>?)").bind(userId, trackId, now).first();
  return !!one;
}

async function trackStreamUrl(request, url, env){
  const trackId = url.searchParams.get("trackId")||"";
  const asset = await env.DB.prepare("SELECT preview_url, full_url FROM track_assets WHERE track_id=?").bind(trackId).first();
  if (!asset) return { ok:false, error:"no asset" };
  const user = await getAuthUser(request, env);
  const access = await hasAccess(env, user?.id, trackId);
  return { ok:true, url: access ? (asset.full_url || asset.preview_url) : asset.preview_url };
}

async function trackPlay(body, env){
  const id = crypto.randomUUID();
  const created = Math.floor(Date.now()/1000);
  await env.DB.prepare("INSERT INTO plays (id,user_id,track_id,artist_id,milestone,seconds,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(id, body.userId||null, body.trackId, body.artistId, body.milestone||"start", body.seconds||0, created).run();
  return { ok:true };
}
