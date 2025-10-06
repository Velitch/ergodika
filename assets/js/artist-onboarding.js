// /assets/js/artist-onboarding.js
(async function(){
  const $ = s => document.querySelector(s);

  async function loadConfig() {
    const res = await fetch("/config/app.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Impossibile caricare /config/app.json");
    const cfg = await res.json();
    const BASE = (cfg?.stripe?.workerBase || "").replace(/\/$/, "");
    if (!BASE) throw new Error("stripe.workerBase mancante in /config/app.json");
    return { cfg, BASE };
  }

  $("#ao-start").addEventListener("click", async ()=>{
    try {
      const { BASE } = await loadConfig();
      const artistId = ($("#ao-id").value||"").trim();
      if(!artistId) return alert("Inserisci un ID artista");

      const u = new URL(`${BASE}/api/payments/artist-onboarding`);
      u.searchParams.set("artistId", artistId);
      u.searchParams.set("redirect", location.origin + "/pages/artist-onboarding.html");

      const r = await fetch(u.toString());
      const j = await r.json();
      if(!j.ok || !j.url){ alert(j.error||"Errore"); return; }
      location.href = j.url; // vai al flow di Stripe Express
    } catch(e) {
      alert(e.message || "Errore di configurazione");
    }
  });

  $("#ao-check").addEventListener("click", async ()=>{
    try {
      const { BASE } = await loadConfig();
      const artistId = ($("#ao-id").value||"").trim();
      if(!artistId) return alert("Inserisci un ID artista");

      const u = new URL(`${BASE}/api/payments/artist-status`);
      u.searchParams.set("artistId", artistId);

      const r = await fetch(u.toString());
      const j = await r.json();

      $("#ao-msg").textContent = j.account_id
        ? (j.payouts_enabled ? "Artista OK: payouts abilitati." : "Artista collegato: completa i dati per abilitare i payouts.")
        : "Artista non collegato.";
    } catch(e) {
      alert(e.message || "Impossibile verificare lo stato artista");
    }
  });
})();
