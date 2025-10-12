/* Ergodika Events — Worker index.js (Cloudflare Workers) */
import { seedEvents } from "./bootstrap.js";

const b64url=(buf)=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const json=(o,h)=>new Response(JSON.stringify(o),{headers:{"Content-Type":"application/json",...(h||{})}});
const jsonErr=(m,h)=>json({ok:false,error:m},h);
const CORS=(allowed)=>req=>{const o=req.headers.get("Origin")||"";const allow=(!allowed||o===allowed)?o:(allowed||"");return{"Access-Control-Allow-Origin":allow,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Credentials":"true","Vary":"Origin"}};
const enc=new TextEncoder(), dec=new TextDecoder();
const setAuthCookie=(jwt)=>({"Set-Cookie":`erg_auth=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`});
const uid=()=>{const a=new Uint8Array(16);crypto.getRandomValues(a);return[...a].map(x=>x.toString(16).padStart(2,"0")).join("")};

async function signJWT(payload, secret){const header=b64url(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));const body=b64url(enc.encode(JSON.stringify(payload)));const data=`${header}.${body}`;const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,enc.encode(data));return `${data}.${b64url(sig)}`;}
function b64pad(s){return s+"=".repeat((4-s.length%4)%4)}
async function verifyJWT(token, secret){try{const[h,b,s]=token.split(".");const data=`${h}.${b}`;const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);const sig=Uint8Array.from(atob(b64pad(s).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const ok=await crypto.subtle.verify("HMAC",key,sig,enc.encode(data));if(!ok)return null;const payload=JSON.parse(dec.decode(Uint8Array.from(atob(b64pad(b).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));if(payload.exp&&Date.now()/1000>payload.exp)return null;return payload;}catch{return null}}
async function safeJson(req){const t=await req.text();if(!t)return null;try{return JSON.parse(t)}catch{return null}}

/* DB helpers */
async function getUserByEmail(env,email){const key=`user:${email}`;const hit=await env.ERG_SESSIONS.get(key);if(hit)return JSON.parse(hit);const row=await env.DB.prepare("SELECT id,email,role FROM users WHERE email=?").bind(email).first();if(!row)return null;await env.ERG_SESSIONS.put(key,JSON.stringify(row),{expirationTtl:3600});return row;}
async function upsertUser(env,email){let u=await getUserByEmail(env,email.toLowerCase());if(u)return u;const id=uid(),now=new Date().toISOString();await env.DB.prepare("INSERT INTO users(id,email,role,created_at,last_login) VALUES(?,?,?,?,?)").bind(id,email.toLowerCase(),"user",now,now).run();const user={id,email:email.toLowerCase(),role:"user"};await env.ERG_SESSIONS.put(`user:${email.toLowerCase()}`,JSON.stringify(user),{expirationTtl:3600});return user;}
async function requireUser(req,env){const cookie=req.headers.get("cookie")||"";const m=/erg_auth=([^;]+)/.exec(cookie);if(!m)return null;const p=await verifyJWT(decodeURIComponent(m[1]),env.JWT_SECRET);return p?.sub?{id:p.sub,email:p.email,role:p.role||"user"}:null;}
async function requireRole(req,env,roles=["admin"]){const u=await requireUser(req,env);if(!u)return null;const dbRole=await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(u.id).first();if(dbRole?.role)u.role=dbRole.role;return roles.includes(u.role)?u:null;}
async function getMembership(env,user_id){return await env.DB.prepare("SELECT tier,status,current_period_end,stripe_customer_id FROM memberships WHERE user_id=?").bind(user_id).first();}
const tierRank=(t)=>({free:0,member:1,plus:2}[t||"free"]??0;

/* Events */
async function listEvents(env){const list=await env.ERG_EVENTS.list({prefix:"event:"});const out=[];for(const {name} of list.keys){const e=await env.ERG_EVENTS.get(name,"json");if(e){e.remaining=Math.max(0,(e.capacity||0)-(e.sold||0));out.push(e);}}out.sort((a,b)=>new Date(a.date_iso)-new Date(b.date_iso));return out;}
async function getEvent(env,id){return await env.ERG_EVENTS.get(`event:${id}`,"json")}
function rid(){const a=new Uint8Array(16);crypto.getRandomValues(a);return[...a].map(x=>x.toString(16).padStart(2,"0")).join("")}

/* Stripe helpers */
async function stripePOST(env,path,form){const r=await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{"Authorization":`Bearer ${env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},body:form});if(!r.ok){const t=await r.text();throw new Error("Stripe: "+t)}return await r.json();}
async function stripeGET(env,path){const r=await fetch(`https://api.stripe.com/v1/${path}`,{headers:{"Authorization":`Bearer ${env.STRIPE_SECRET_KEY}`}});if(!r.ok)return null;return await r.json();}

/* Materials policies */
async function canDownload(env,user,meta){const policy=meta.policy||{type:"public"};if(policy.type==="public")return true;if(!user)return false;if(policy.type==="membership"){const m=await getMembership(env,user.id);const need=policy.min_tier||"member";return m&&m.status==="active"&&tierRank(m.tier)>=tierRank(need);}if(policy.type==="event_ticket"){const row=await env.DB.prepare("SELECT 1 FROM tickets_index WHERE user_id=? AND event_id=? LIMIT 1").bind(user.id,policy.event_id).first();return !!row;}return false;}

/* Email via Resend */
async function sendMagicLink(env,email,token){const url=`${env.SITE_BASE_URL}/dashboard.html?token=${encodeURIComponent(token)}`;const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to:email,subject:"Accedi a Ergodika",html:`<p>Ciao! Clicca per accedere:</p><p><a href="${url}">${url}</a></p><p>Scade in 15 minuti.</p>`})});if(!r.ok)throw new Error("Mailer error");}
async function sendEmail(env,to,subject,html){const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:env.EMAIL_FROM,to,subject,html})});if(!r.ok)throw new Error("Mailer error");}

/* Pass page */
function renderPassHtml(ticket,event,base){const scanUrl=`${base}/staff-scan.html?ticket=${ticket.id}`;return `<!doctype html><meta charset="utf-8"><title>Biglietto — ${event.title}</title><body><h1>${event.title}</h1><p>${new Date(event.date_iso).toLocaleString("it-IT")} — ${event.location}</p><p>Ticket: <b>${ticket.id}</b></p><p><a href="${scanUrl}">Apri per controllo</a></p></body>`;}

/* Reminders */
async function sendEventReminder(env,event,hours){const flagKey=`reminder_sent:${event.id}:${hours}`;const sentFlag=await env.ERG_SESSIONS.get(flagKey);if(sentFlag)return 0;const keys=await env.ERG_TICKETS.list({prefix:`tickets_by_event:${event.id}:`});let sent=0;for(const k of keys.keys){const id=k.name.split(":").pop();const t=await env.ERG_TICKETS.get(`ticket:${id}`,"json");if(!t||t.status!=="valid")continue;await sendEmail(env,t.email,`Promemoria: ${event.title}`,`<p>Ciao! Ti ricordiamo <b>${event.title}</b> — ${new Date(event.date_iso).toLocaleString("it-IT")} (${event.location}).</p><p>Pass: <a href="${env.SITE_BASE_URL}/staff-scan.html?ticket=${t.id}">apri qui</a></p>`);sent++;}if(sent>0)await env.ERG_SESSIONS.put(flagKey,String(Date.now()),{expirationTtl:60*60*36});return sent;}

export default {
  async fetch(req, env, ctx){
    const url=new URL(req.url);const {pathname,searchParams}=url;const headers=CORS(env.SITE_BASE_URL)(req);
    if(req.method==="OPTIONS")return new Response(null,{headers});

    if(pathname==="/api/init"&&req.method==="POST"){for(const e of seedEvents){const k=`event:${e.id}`;const ex=await env.ERG_EVENTS.get(k);if(!ex)await env.ERG_EVENTS.put(k,JSON.stringify({...e,sold:0,status:"open"}));}return json({ok:true},headers);}
    if(pathname==="/api/events"&&req.method==="GET"){return json({ok:true,events:await listEvents(env)},headers);}

    if(pathname==="/api/checkout"&&req.method==="POST"){
      const b=await safeJson(req);const {eventId,quantity=1,email}=b||{};if(!eventId||!email)return jsonErr("eventId e email sono obbligatori",headers);
      const ev=await getEvent(env,eventId);if(!ev)return jsonErr("Evento non trovato",headers);if(ev.status==="closed")return jsonErr("Vendite chiuse per questo evento",headers);
      const available=(ev.capacity||0)-(ev.sold||0);if(available<quantity)return jsonErr("Posti insufficienti",headers);
      let coupon=null;try{const user=await getUserByEmail(env,email.toLowerCase());if(user){const m=await getMembership(env,user.id);if(m&&m.status==="active"){coupon=m.tier==="plus"?(env.PLUS_COUPON_ID||null):(env.MEMBER_COUPON_ID||null);}}}catch{}
      const f=new URLSearchParams();f.set("mode","payment");f.set("payment_method_types[]","card");f.set("success_url",`${env.SITE_BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&event=${encodeURIComponent(ev.id)}`);f.set("cancel_url",`${env.SITE_BASE_URL}/events.html?canceled=1`);f.set("line_items[0][price_data][currency]","eur");f.set("line_items[0][price_data][product_data][name]",`${ev.title} — ${ev.date_iso}`);f.set("line_items[0][price_data][unit_amount]`, String(Math.round((ev.price_eur||0)*100)));f.set("line_items[0][quantity]",String(quantity));f.set("allow_promotion_codes","true");f.set("customer_email",email);if(coupon)f.set("discounts[0][coupon]",coupon);
      const session=await stripePOST(env,"checkout/sessions",f);return json({ok:true,url:session.url},headers);
    }

    if(pathname==="/api/confirm"&&req.method==="POST"){
      const session_id=searchParams.get("session_id");const eventId=searchParams.get("event");if(!session_id||!eventId)return jsonErr("session_id e event sono obbligatori",headers);
      const cached=await env.ERG_SESSIONS.get(`sess:${session_id}`);if(cached){const t=await env.ERG_TICKETS.get(`ticket:${cached}`,"json");return json({ok:true,alreadyIssued:true,ticket:t},headers);}
      const sess=await stripeGET(env,`checkout/sessions/${session_id}`);if(!sess||sess.payment_status!=="paid")return jsonErr("Pagamento non confermato",headers);
      const ev=await getEvent(env,eventId);if(!ev)return jsonErr("Evento non trovato",headers);
      const ticketId=rid();const email=sess.customer_details?.email||sess.customer_email||"unknown";const ticket={id:ticketId,eventId,email,quantity:1,createdAt:new Date().toISOString(),status:"valid"};
      await env.ERG_TICKETS.put(`ticket:${ticketId}`,JSON.stringify(ticket));await env.ERG_SESSIONS.put(`sess:${session_id}`,ticketId);await env.ERG_TICKETS.put(`tickets_by_event:${ev.id}:${ticketId}`,"1");
      ev.sold=(ev.sold||0)+1;await env.ERG_EVENTS.put(`event:${ev.id}`,JSON.stringify(ev));
      const urow=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind((email||"").toLowerCase()).first();if(urow){await env.DB.prepare("INSERT INTO tickets_index(ticket_id,user_id,event_id,created_at) VALUES(?,?,?,?)").bind(ticketId,urow.id,ev.id,new Date().toISOString()).run();}
      return json({ok:true,ticket},headers);
    }

    if(pathname.startsWith("/pass/")&&req.method==="GET"){const id=pathname.split("/").pop();const t=await env.ERG_TICKETS.get(`ticket:${id}`,"json");if(!t)return new Response("Biglietto non trovato",{status:404});const ev=await getEvent(env,t.eventId);return new Response(renderPassHtml(t,ev,env.SITE_BASE_URL),{headers:{"Content-Type":"text/html; charset=utf-8"}});}
    if(pathname==="/api/verify"&&req.method==="POST"){const auth=req.headers.get("authorization")||"";const token=auth.replace("Bearer ","");if(token!==env.ADMIN_VERIFY_SECRET)return new Response("Unauthorized",{status:401,headers});const b=await safeJson(req);const {ticketId}=b||{};if(!ticketId)return jsonErr("ticketId mancante",headers);const key=`ticket:${ticketId}`;const t=await env.ERG_TICKETS.get(key,"json");if(!t)return jsonErr("Biglietto non trovato",headers);if(t.status==="used")return json({ok:false,message:"Già usato",ticket:t},headers);t.status="used";t.usedAt=new Date().toISOString();await env.ERG_TICKETS.put(key,JSON.stringify(t));return json({ok:true,message:"Valido — ingresso consentito",ticket:t},headers);}

    if(pathname==="/auth/request"&&req.method==="POST"){const b=await safeJson(req);const email=b?.email?.trim();if(!email)return jsonErr("Email obbligatoria",headers);const token=uid();await env.ERG_SESSIONS.put(`magic:${token}`,email.toLowerCase(),{expirationTtl:900});try{await sendMagicLink(env,email,token);}catch{return jsonErr("Invio email fallito",headers);}return json({ok:true,sent:true},headers);}
    if(pathname==="/auth/callback"&&req.method==="POST"){const b=await safeJson(req);const token=b?.token;const email=await env.ERG_SESSIONS.get(`magic:${token}`);if(!email)return jsonErr("Token non valido/scaduto",headers);const user=await upsertUser(env,email);const jwt=await signJWT({sub:user.id,email:user.email,role:user.role,exp:Math.floor(Date.now()/1000)+60*60*24*30},env.JWT_SECRET);return new Response(JSON.stringify({ok:true,user}),{headers:{"Content-Type":"application/json",...headers,...setAuthCookie(jwt)}});}
    if(pathname==="/me"&&req.method==="GET"){let u=await requireUser(req,env);if(!u)return json({ok:false,user:null},headers);const db=await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(u.id).first();if(db?.role)u.role=db.role;const memb=await getMembership(env,u.id);return json({ok:true,user:u,membership:memb||{tier:"free",status:"none"}},headers);}
    if(pathname==="/auth/logout"&&req.method==="POST"){return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json",...headers,"Set-Cookie":"erg_auth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"}});}

    if(pathname==="/api/memberships/checkout"&&req.method==="POST"){const u=await requireUser(req,env);if(!u)return jsonErr("Devi accedere",headers);const b=await safeJson(req);const price=b?.price_id;if(!price)return jsonErr("price_id mancante",headers);const f=new URLSearchParams();f.set("mode","subscription");f.set("success_url",`${env.SITE_BASE_URL}/dashboard.html`);f.set("cancel_url",`${env.SITE_BASE_URL}/membership.html`);f.set("line_items[0][price]",price);f.set("line_items[0][quantity]","1");f.set("customer_email",u.email);const s=await stripePOST(env,"checkout/sessions",f);return json({ok:true,url:s.url},headers);}
    if(pathname==="/api/memberships/portal"&&req.method==="POST"){const u=await requireUser(req,env);if(!u)return jsonErr("Devi accedere",headers);const m=await getMembership(env,u.id);if(!m?.stripe_customer_id)return jsonErr("Nessun cliente Stripe collegato",headers);const f=new URLSearchParams();f.set("customer",m.stripe_customer_id);f.set("return_url",`${env.SITE_BASE_URL}/dashboard.html`);const p=await stripePOST(env,"billing_portal/sessions",f);return json({ok:true,url:p.url},headers);}
    if(pathname==="/stripe/webhook"&&req.method==="POST"){const evt=await req.json();if(evt.type==="checkout.session.completed"&&evt.data.object.mode==="subscription"){const s=evt.data.object;const email=(s.customer_details?.email||"").toLowerCase();let priceId="";try{const full=await stripeGET(env,`checkout/sessions/${s.id}?expand[]=line_items.data.price`);priceId=full?.line_items?.data?.[0]?.price?.id||"";}catch{}const tier=priceId.includes("plus")?"plus":"member";if(email){const user=await upsertUser(env,email);await env.DB.prepare("INSERT INTO memberships(user_id,stripe_customer_id,stripe_subscription_id,tier,status,current_period_end) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id, stripe_subscription_id=excluded.stripe_subscription_id, tier=excluded.tier, status=excluded.status, current_period_end=excluded.current_period_end").bind(user.id,s.customer,s.subscription,tier,"active",null).run();}}return new Response("ok",{headers});}

    if(pathname==="/api/materials"&&req.method==="GET"){const u=await requireUser(req,env);const list=await env.ERG_MATERIALS.list({prefix:"material:"});const out=[];for(const k of list.keys){const m=await env.ERG_MATERIALS.get(k.name,"json");if(m&&await canDownload(env,u,m))out.push({id:m.id,title:m.title});}return json({ok:true,materials:out},headers);}
    if(pathname.startsWith("/api/materials/")&&req.method==="GET"){const id=pathname.split("/").pop();const meta=await env.ERG_MATERIALS.get(`material:${id}`,"json");if(!meta)return jsonErr("Materiale non trovato",headers);const u=await requireUser(req,env);const ok=await canDownload(env,u,meta);if(!ok)return new Response("Forbidden",{status:403,headers});const obj=await env.R2.get(meta.r2_key);if(!obj)return jsonErr("File mancante",headers);const h=new Headers(headers);h.set("Content-Type",obj.httpMetadata?.contentType||"application/octet-stream");h.set("Content-Disposition",`attachment; filename="${meta.r2_key.split('/').pop()}"`);return new Response(obj.body,{headers:h});}

    if(pathname==="/admin/events/export.csv"&&req.method==="GET"){const u=await requireRole(req,env,["teacher","admin"]);if(!u)return new Response("Forbidden",{status:403,headers});const eventId=searchParams.get("event");if(!eventId)return jsonErr("parametro 'event' mancante",headers);const keys=await env.ERG_TICKETS.list({prefix:`tickets_by_event:${eventId}:`});const rows=[["ticket_id","event_id","email","quantity","status","created_at"]];for(const k of keys.keys){const id=k.name.split(":").pop();const t=await env.ERG_TICKETS.get(`ticket:${id}`,"json");if(t)rows.push([t.id,t.eventId,t.email,String(t.quantity||1),t.status,t.createdAt]);}const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\\n");const h=new Headers(headers);h.set("Content-Type","text/csv; charset=utf-8");h.set("Content-Disposition",`attachment; filename="iscritti_${eventId}.csv"`);return new Response(csv,{headers:h});}
    if(pathname==="/admin/events/remind"&&req.method==="POST"){const u=await requireRole(req,env,["teacher","admin"]);if(!u)return new Response("Forbidden",{status:403,headers});const {id,hours=24}=await safeJson(req)||{};if(!id)return jsonErr("id mancante",headers);const ev=await env.ERG_EVENTS.get(`event:${id}`,"json");if(!ev)return jsonErr("Evento non trovato",headers);const sent=await sendEventReminder(env,ev,Number(hours));return json({ok:true,sent},headers);}

    return new Response("Not found",{status:404,headers});
  },
  async scheduled(event, env, ctx){
    const list=await env.ERG_EVENTS.list({prefix:"event:"});const now=Date.now();
    for(const {name} of list.keys){const ev=await env.ERG_EVENTS.get(name,"json");if(!ev)continue;const when=Date.parse(ev.date_iso||"");if(!Number.isFinite(when)||when<now)continue;const diffH=(when-now)/(1000*60*60);if(env.REMINDER_H24==="true"&&Math.abs(diffH-24)<=0.5)ctx.waitUntil(sendEventReminder(env,ev,24));if(env.REMINDER_H2==="true"&&Math.abs(diffH-2)<=0.5)ctx.waitUntil(sendEventReminder(env,ev,2));}
  }
};