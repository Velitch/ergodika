(function(){
  async function getWorkerBase() {
    try {
      const res = await fetch("/config/app.json", { cache: "no-cache" });
      if (!res.ok) throw 0;
      const cfg = await res.json();
      const wb = (cfg?.stripe?.workerBase || "").replace(/\/$/, "");
      if (wb) return wb;
    } catch (e) {}
    return "https://www.ergodika.it";
  }

  function absoluteRedirectFromQuery() {
    const qs = new URLSearchParams(location.search);
    const dest = qs.get("redirect") || "/pages/account.html";
    const siteBase = location.origin;
    return dest.startsWith("http") ? dest : siteBase + dest;
  }

  async function registerHandlers() {
    const WORKER = await getWorkerBase();
    const redirect = absoluteRedirectFromQuery();
    const $ = (s) => document.querySelector(s);
    const msg = $("#msg");

    const signup = $("#signup-form");
    if (signup) {
      signup.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (msg) msg.textContent = "Creazione in corso…";
        try {
          const fd = new FormData(signup);
          const payload = Object.fromEntries(fd.entries());
          const res = await fetch(`${WORKER}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (!j.ok) throw new Error(j.error || "Errore registrazione");
          if (msg) msg.textContent = "Fatto! Reindirizzo…";
          location.href = redirect;
        } catch (err) {
          console.error(err);
          if (msg) msg.textContent = err.message;
        }
      });
    }

    const login = $("#login-form");
    if (login) {
      login.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (msg) msg.textContent = "Accesso in corso…";
        try {
          const fd = new FormData(login);
          const payload = Object.fromEntries(fd.entries());
          const res = await fetch(`${WORKER}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload)
          });
          const j = await res.json();
          if (!j.ok) throw new Error(j.error || "Credenziali non valide");
          if (msg) msg.textContent = "Bentornato!";
          location.href = redirect;
        } catch (err) {
          console.error(err);
          if (msg) msg.textContent = err.message;
        }
      });
    }

    const gbtn = document.getElementById("google-btn");
    if (gbtn) {
      gbtn.addEventListener("click", () => {
        try {
          console.log("[Google] using workerBase:", WORKER, "redirect:", redirect);
          location.href = `${WORKER}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
        } catch (e) {
          console.error("[Google OAuth click] error:", e);
          alert("Errore avvio Google OAuth. Controlla /config/app.json.");
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerHandlers);
  } else {
    registerHandlers();
  }
})();
