// /assets/js/payments.js
window.ErgodikaPayments = (function () {
  let CONFIG = null;
  let WORKER = null;

  async function loadConfig() {
    if (CONFIG) return CONFIG;
    const res = await fetch("/config/app.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Impossibile caricare /config/app.json");
    CONFIG = await res.json();
    WORKER = (CONFIG?.stripe?.workerBase || "").replace(/\/$/, "");
    if (!WORKER) throw new Error("stripe.workerBase mancante in /config/app.json");
    return CONFIG;
  }

  async function donate(amountInCents, artistId, memo = "Ergodika support", btn) {
    await loadConfig();
    try {
      if (btn) { btn.disabled = true; btn.dataset._label = btn.textContent; btn.textContent = "Collegamento…"; }
      const r = await fetch(`${WORKER}/api/checkout/one-time`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountInCents, artistId, memo })
      });
      const { url, ok, error } = await r.json();
      if (error || (!ok && !url)) throw new Error(error || "Errore sconosciuto");
      window.location.href = url;
    } catch (e) {
      alert("Pagamento non avviato: " + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset._label || btn.textContent; }
    }
  }

  async function subscribe({ tier, priceId, memo = "Ergodika subscription" } = {}, btn) {
    await loadConfig();
    try {
      if (btn) { btn.disabled = true; btn.dataset._label = btn.textContent; btn.textContent = "Collegamento…"; }
      const payload = priceId ? { priceId, memo } : { tier, memo };
      const r = await fetch(`${WORKER}/api/checkout/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const { url, error } = await r.json();
      if (error || !url) throw new Error(error || "Errore sconosciuto");
      window.location.href = url;
    } catch (e) {
      alert("Abbonamento non avviato: " + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset._label || btn.textContent; }
    }
  }

  // Autowire con data-attributes
  function bindDonationButtons(selector = "[data-donate]") {
    document.querySelectorAll(selector).forEach((btn) => {
      const amount = parseInt(btn.dataset.amount, 10);
      const artist = btn.dataset.artist; // es. "test-artist-001"
      btn.addEventListener("click", (e) => donate(amount, artist, undefined, e.currentTarget));
    });
  }

  function bindSubscriptionButtons(selector = "[data-sub-tier],[data-sub-price]") {
    document.querySelectorAll(selector).forEach((btn) => {
      const tier = btn.dataset.subTier;       // "3" o "7"
      const priceId = btn.dataset.subPrice;   // alternativa: price_...
      btn.addEventListener("click", (e) => subscribe({ tier, priceId }, e.currentTarget));
    });
  }

  async function init() {
    try { await loadConfig(); } catch (e) { console.error(e); alert(e.message); }
    bindDonationButtons();
    bindSubscriptionButtons();
  }

  return { init, donate, subscribe, bindDonationButtons, bindSubscriptionButtons };
})();

document.addEventListener("DOMContentLoaded", () => window.ErgodikaPayments.init());
