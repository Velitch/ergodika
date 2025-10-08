(async function(){
  async function getWorkerBase() {
    try {
      const res = await fetch("/config/app.json",{cache:"no-cache"});
      if (!res.ok) throw 0;
      const cfg = await res.json();
      const wb = (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
      if (wb) return wb;
    } catch(e){}
    // Fallback sicuro: aggiorna qui se usi un custom domain del Worker
    return "https://www.ergodika.it/api";
  }
  const $ = s => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const redirect = qs.get("redirect") || "/";

  // Signup
  const signup = document.getElementById("signup-form");
  if (signup) {
    signup.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const msg = document.getElementById("msg");
      msg && (msg.textContent = "Creazione in corso…");
      try {
        const fd = new FormData(signup);
        const payload = Object.fromEntries(fd.entries());
        const WORKER = await getWorkerBase();
        const j = await fetch(`${WORKER}/api/auth/register`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload),
          credentials:"include"
        }).then(r=>r.json());
        if (!j.ok) throw new Error(j.error || "Errore registrazione");
        msg && (msg.textContent = "Fatto! Reindirizzo…");
        setTimeout(()=> location.href = redirect, 400);
      } catch (err) { msg && (msg.textContent = err.message); }
    });
  }

  // Login
  const login = document.getElementById("login-form");
  if (login) {
    login.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const msg = document.getElementById("msg");
      msg && (msg.textContent = "Accesso in corso…");
      try {
        const fd = new FormData(login);
        const payload = Object.fromEntries(fd.entries());
        const WORKER = await getWorkerBase();
        const j = await fetch(`${WORKER}/api/auth/login`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload),
          credentials:"include"
        }).then(r=>r.json());
        if (!j.ok) throw new Error(j.error || "Credenziali non valide");
        msg && (msg.textContent = "Bentornato!");
        setTimeout(()=> location.href = redirect, 300);
      } catch (err) { msg && (msg.textContent = err.message); }
    });
  }

  // Google OAuth (con fallback + try/catch)
  const gbtn = document.getElementById("google-btn");
  if (gbtn) {
    gbtn.addEventListener("click", async ()=>{
      try {
        const WORKER = await getWorkerBase();
        // Passo il redirect DENTRO lo state (il Worker lo rilegge in callback)
        location.href = `${WORKER}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
      } catch (e) {
        alert("Impossibile avviare Google OAuth. Controlla /config/app.json (workerBase).");
      }
    });
  }
})();

const qs = new URLSearchParams(location.search);
const dest = qs.get("redirect") || "/";
// forza assoluto sul sito
const siteBase = location.origin; // es. https://www.ergodika.it
const redirect = dest.startsWith("http") ? dest : siteBase + dest;

// ...
location.href = `${WORKER}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
