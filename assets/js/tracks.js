(async function(){
  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return { WORKER:(cfg?.stripe?.workerBase||"").replace(/\/$/,""), STRIPE_PUB: cfg?.stripe?.publicKey||"" };
  }
  const $ = s => document.querySelector(s);
  const results = $("#results");
  const audio = $("#audio");
  const nowTitle = $("#now-title");
  let current = null;

  async function search(){
    const { WORKER } = await base();
    const u = new URL(`${WORKER}/api/tracks/search`);
    const q = $("#q").value.trim();
    const genre = $("#genre").value;
    const premium = $("#premium").value;
    if (q) u.searchParams.set("q", q);
    if (genre) u.searchParams.set("genre", genre);
    if (premium) u.searchParams.set("premium", premium);
    const j = await fetch(u, { credentials:"include" }).then(r=>r.json());
    if (!j.ok) { results.innerHTML = '<p class="small">Errore ricerca.</p>'; return; }
    render(j.items||[]);
  }

  function render(items){
    results.innerHTML = '';
    if (!items.length) { results.innerHTML = '<p class="small">Nessun brano.</p>'; return; }
    for (const it of items) {
      const el = document.createElement("div");
      el.className = "card track";
      el.innerHTML = `
        <img src="${it.cover_url||'/assets/images/icon-192.png'}" alt="">
        <div class="meta">
          <div style="font-weight:800">${it.title}</div>
          <div class="small">${it.artist_name||''}</div>
          <div class="badge">${it.genre||''} ${it.is_premium? '• Premium':''}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn alt" data-play="${it.id}">Play</button>
          ${it.is_premium? '<button class="btn alt" data-unlock="'+it.id+'">Sblocca</button>':''}
        </div>
      `;
      results.appendChild(el);
    }
    results.querySelectorAll('[data-play]').forEach(b=>{
      b.addEventListener('click', ()=> loadTrack(b.dataset.play));
    });
    results.querySelectorAll('[data-unlock]').forEach(b=>{
      b.addEventListener('click', ()=> unlockTrack(b.dataset.unlock));
    });
  }

  async function loadTrack(id){
    const { WORKER } = await base();
    const u = new URL(`${WORKER}/api/tracks/by-id`);
    u.searchParams.set("id", id);
    const t = await fetch(u, { credentials:"include" }).then(r=>r.json());
    if (!t.ok) return;
    current = t.track;
    nowTitle.textContent = `${t.track.title} — ${t.track.artist_name||''}`;
    // Get streaming url (preview or full)
    const u2 = new URL(`${WORKER}/api/tracks/stream-url`);
    u2.searchParams.set("trackId", id);
    const s = await fetch(u2, { credentials:"include" }).then(r=>r.json());
    if (!s.ok) return;
    audio.src = s.url;
    audio.play();
  }

  async function unlockTrack(id){
    const { WORKER } = await base();
    const price = prompt("Prezzo sblocco (es. 0.49)", "0.49");
    if (!price) return;
    const j = await fetch(`${WORKER}/api/checkout/unlock`, {
      method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include",
      body: JSON.stringify({ trackId: id, price: parseFloat(price) })
    }).then(r=>r.json());
    if (!j.ok) { alert(j.error||'Errore'); return; }
    location.href = j.url; // Stripe Checkout
  }

  // player bar
  $("#play").addEventListener("click", ()=>{
    if (!audio.src) return;
    if (audio.paused) audio.play(); else audio.pause();
  });
  $("#tip1").addEventListener("click", async ()=>{
    if (!current) return;
    const { WORKER } = await base();
    const j = await fetch(`${WORKER}/api/checkout/tip`, {
      method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include",
      body: JSON.stringify({ artistId: current.artist_id, amount: 1.00, memo: `Tip per ${current.title}` })
    }).then(r=>r.json());
    if (j.ok && j.url) location.href = j.url;
  });
  $("#unlock").addEventListener("click", ()=> { if (current) unlockTrack(current.id); });

  // bind
  $("#btn-search").addEventListener("click", search);
  $("#q").addEventListener("keydown", (e)=>{ if (e.key==="Enter") search(); });

  // first load
  search();
})();