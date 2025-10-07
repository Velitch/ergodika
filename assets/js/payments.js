(function () {
  function ready(fn){
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(async function () {
    async function getConfig() {
      const r = await fetch("/config/app.json", { cache: "no-cache" });
      const j = await r.json();
      return {
        workerBase: (j?.stripe?.workerBase || "").replace(/\/$/, ""),
        prices: j?.stripe?.prices || {}
      };
    }
    function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
    function toast(msg){
      const t=document.createElement("div");
      t.textContent=msg;
      Object.assign(t.style,{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:"16px",background:"#0b1f2a",color:"#fff",padding:"8px 12px",borderRadius:"999px",zIndex:9999});
      document.body.appendChild(t); setTimeout(()=>t.remove(),2500);
    }
    async function postJSON(url, body) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body || {})
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || ("HTTP " + res.status));
      return data;
    }

    const cfg = await getConfig();
    const WORKER = cfg.workerBase;

    // Selettori supportati
    const subs    = $all("[data-action='subscribe']");
    const tips    = $all("[data-action='tip']");
    const unlocks = $all("[data-action='unlock']");
    const donate  = $all("[data-donate]"); // compat con il tuo markup

    console.log("[payments] ready", {
      WORKER, subs: subs.length, tips: tips.length, unlocks: unlocks.length, donate: donate.length, prices: cfg.prices
    });

    async function startSubscription(priceId){
      if (!priceId) throw new Error("PriceId mancante (usa data-price-id o data-tier + /config/app.json)");
      const out = await postJSON(`${WORKER}/api/checkout/subscription`, { priceId });
      if (!out?.url) throw new Error("Nessun URL ricevuto");
      location.href = out.url;
    }
    async function startOneTime({ amount, artistId, memo }){
      const eur = Number(amount);
      if (!eur || eur <= 0) throw new Error("Importo non valido");
      const out = await postJSON(`${WORKER}/api/checkout/one-time`, {
        amount: eur,
        artistId: artistId || "unknown",
        memo: memo || "Supporto Ergodika"
      });
      if (!out?.url) throw new Error("Nessun URL ricevuto");
      location.href = out.url;
    }

    // SUBSCRIBE
    subs.forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const priceId = btn.dataset.priceId || cfg.prices?.[btn.dataset.tier] || "";
          await startSubscription(priceId);
        } catch (err) { console.error("[subscribe] error:", err); toast("Abbonamento non avviato: " + err.message); }
      });
    });

    // TIP
    tips.forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const amount = btn.dataset.amount || prompt("Quanto vuoi offrire? (in €)", "3");
          const artistId = btn.dataset.artistId || btn.dataset.artist || "unknown";
          await startOneTime({ amount, artistId, memo: "Tip all'artista" });
        } catch (err) { console.error("[tip] error:", err); toast("Tip non avviata: " + err.message); }
      });
    });

    // UNLOCK
    unlocks.forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const amount = btn.dataset.amount || "1";
          const artistId = btn.dataset.artistId || btn.dataset.artist || "unknown";
          const memo = btn.dataset.title || "Sblocco brano";
          await startOneTime({ amount, artistId, memo });
        } catch (err) { console.error("[unlock] error:", err); toast("Sblocco non avviato: " + err.message); }
      });
    });

    // DONATE (compat): se c'è price/tier → subscription; altrimenti se c'è amount → one-time
    donate.forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const priceId = btn.dataset.priceId || cfg.prices?.[btn.dataset.tier] || "";
          if (priceId) {
            await startSubscription(priceId);
          } else {
            const amount = btn.dataset.amount || "1";
            const artistId = btn.dataset.artistId || btn.dataset.artist || "unknown";
            await startOneTime({ amount, artistId, memo: "Donazione" });
          }
        } catch (err) { console.error("[donate] error:", err); toast("Operazione non avviata: " + err.message); }
      });
    });
  });
})();
