// JS per pagina Members: status, env badge, Billing Portal, Donazioni artista
(async function () {
  const $ = (sel) => document.querySelector(sel);

  // --- Helpers config ---
  async function loadConfig() {
    const res = await fetch("/config/app.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Impossibile caricare /config/app.json");
    const cfg = await res.json();
    const WORKER = (cfg?.stripe?.workerBase || "").replace(/\/$/, "");
    return { cfg, WORKER };
  }

  // --- Status dal querystring (sub=ok|cancel) ---
  function showStatusFromQuery() {
    const p = new URLSearchParams(location.search);
    const box = $("#status");
    if (!box) return;
    if (p.has("sub")) {
      const v = p.get("sub");
      box.classList.add("notice", "show");
      if (v === "ok") { box.classList.add("ok"); box.textContent = "Abbonamento attivo! Controlla la mail per la ricevuta."; }
      else { box.classList.add("warn"); box.textContent = "Operazione annullata o non completata."; }
    }
  }

  // --- ENV badge (TEST/LIVE) ---
  async function paintEnvBadge() {
    try {
      const res = await fetch("/config/app.json", { cache: "no-cache" });
      const cfg = await res.json();
      const pk = cfg?.stripe?.publicKey || "";
      const badge = $("#env");
      if (badge) badge.textContent = pk.startsWith("pk_test_") ? "TEST MODE" : "LIVE MODE";
    } catch {}
  }

  // --- Billing Portal ---
  async function openBillingPortal() {
    const btn = $("#open-portal");
    const email = ($("#email").value || "").trim();
    if (!email) return alert("Inserisci un'email valida.");

    try {
      btn.disabled = true; const prev = btn.textContent; btn.textContent = "Verifica…";
      const { WORKER } = await loadConfig();

      // 1) Lookup customer by email
      const r1 = await fetch(`${WORKER}/api/customers/find?email=${encodeURIComponent(email)}`);
      const j1 = await r1.json();
      if (!j1.ok || !j1.customerId) throw new Error("Cliente non trovato. Verifica l'email usata al checkout.");

      // 2) Redirect al Billing Portal
      const url = `${WORKER}/api/billing-portal?customer=${encodeURIComponent(j1.customerId)}&return=/pages/members.html`;
      window.location.href = url;
    } catch (e) {
      alert(e.message || "Impossibile aprire il Billing Portal.");
    } finally {
      btn.disabled = false; btn.textContent = "Apri Billing Portal";
    }
  }

  // --- Donazioni: verifica artista e abilita bottoni ---
  async function verifyArtist() {
    const input = $("#artist-id");
    const btn = $("#verify-artist");
    const status = $("#artist-status");
    const artistId = (input.value || "").trim();
    if (!artistId) return alert("Inserisci un ID artista.");

    try {
      btn.disabled = true; const prev = btn.textContent; btn.textContent = "Verifica…";
      const { WORKER } = await loadConfig();

      const r = await fetch(`${WORKER}/api/payments/artist-status?artistId=${encodeURIComponent(artistId)}`);
      const j = await r.json();
      if (!j.ok || !j.account_id) throw new Error("Artista non trovato o non collegato.");

      // Aggiorna stato leggibile
      status.textContent = j.payouts_enabled
        ? "Artista verificato (payouts abilitati)."
        : "Artista collegato (payouts non ancora abilitati).";

      // Abilita bottoni donazione: aggiunge data-donate e imposta data-artist
      document.querySelectorAll("[data-donate-pending]").forEach((b) => {
        b.dataset.artist = artistId;
        b.setAttribute("data-donate", "");
        b.removeAttribute("data-donate-pending");
        b.removeAttribute("disabled");
      });

      // Collega i bottoni ora che hanno l'attributo corretto
      if (window.ErgodikaPayments?.bindDonationButtons) {
        window.ErgodikaPayments.bindDonationButtons("[data-donate]");
      }
    } catch (e) {
      alert(e.message || "Verifica artista non riuscita.");
    } finally {
      btn.disabled = false; btn.textContent = "Verifica artista";
    }
  }

  // --- Bind events ---
  function bind() {
    const portalBtn = $("#open-portal");
    if (portalBtn) portalBtn.addEventListener("click", openBillingPortal);

    const verifyBtn = $("#verify-artist");
    if (verifyBtn) verifyBtn.addEventListener("click", verifyArtist);
  }

  // init
  showStatusFromQuery();
  paintEnvBadge();
  bind();
})();
