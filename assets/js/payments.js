window.ErgodikaPayments = {
  async subscription(planKey){
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    const WORKER = (cfg?.stripe?.workerBase||"").replace(/\/$/,"");
    const priceId = cfg?.stripe?.prices?.[planKey];
    if (!priceId) { alert("Configurazione piano mancante"); return; }
    const j = await fetch(`${WORKER}/api/checkout/subscription`, {
      method:"POST", headers:{ "Content-Type":"application/json" }, credentials:"include",
      body: JSON.stringify({ priceId })
    }).then(r=>r.json());
    if (j.ok && j.url) location.href = j.url; else alert(j.error||"Errore");
  }
};