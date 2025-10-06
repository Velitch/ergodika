(async function(){
  const form = document.getElementById('artist-form');
  const box = document.getElementById('result');
  const link = document.getElementById('artist-link');
  const tokenEl = document.getElementById('artist-token');
  const connectBtn = document.getElementById('connect-stripe');

  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
  }

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    try {
      const WORKER = await base();
      const r = await fetch(`${WORKER}/api/artists/register`, {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Errore registrazione');

      const href = `/pages/artist.html?id=${encodeURIComponent(j.artist.artistId)}`;
      link.href = href; link.textContent = location.origin + href;
      tokenEl.textContent = j.token;
      box.style.display = 'block';

      connectBtn.onclick = async ()=>{
        const u = new URL(`${WORKER}/api/payments/artist-onboarding`);
        u.searchParams.set("artistId", j.artist.artistId);
        u.searchParams.set("redirect", location.origin + href);
        const r2 = await fetch(u.toString());
        const j2 = await r2.json();
        if (!j2.ok || !j2.url) { alert(j2.error || 'Errore onboarding'); return; }
        location.href = j2.url;
      };
    } catch (err) {
      alert(err.message);
    }
  });
})();
