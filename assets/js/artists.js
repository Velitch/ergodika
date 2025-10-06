(async function(){
  const grid = document.getElementById('grid');

  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
  }

  function card(a) {
    const el = document.createElement('a');
    el.className = 'card';
    el.href = `/pages/artist.html?id=${encodeURIComponent(a.artistId)}`;
    el.innerHTML = `
      <img src="${a.avatarUrl || '/assets/images/icon-192.png'}" alt="">
      <div class="meta">
        <div class="name">${a.name}</div>
        <div class="id">@${a.artistId}</div>
      </div>
    `;
    return el;
  }

  try {
    const WORKER = await base();
    const r = await fetch(`${WORKER}/api/artists/list`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Errore');
    grid.innerHTML = '';
    j.artists.forEach(a => grid.appendChild(card(a)));
  } catch (e) {
    grid.innerHTML = `<p class="hint">Nessun artista o errore di caricamento.</p>`;
  }
})();
