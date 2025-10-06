(async function(){
  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
  }
  const $ = s => document.querySelector(s);
  const qs = new URLSearchParams(location.search);
  const redirect = qs.get("redirect") || "/";

  // Signup
  const signup = document.getElementById("signup-form");
  if (signup) {
    signup.addEventListener("submit", async (e)=>{
      e.preventDefault();
      $("#msg").textContent = "Creazione in corso…";
      try {
        const fd = new FormData(signup);
        const payload = Object.fromEntries(fd.entries());
        const WORKER = await base();
        const j = await fetch(`${WORKER}/api/auth/register`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload),
          credentials:"include"
        }).then(r=>r.json());
        if (!j.ok) throw new Error(j.error || "Errore registrazione");
        $("#msg").textContent = "Fatto! Reindirizzo…";
        setTimeout(()=> location.href = redirect, 400);
      } catch (err) { $("#msg").textContent = err.message; }
    });
    document.getElementById("google-btn")?.addEventListener("click", async ()=>{
      const WORKER = await base();
      location.href = `${WORKER}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
    });
  }

  // Login
  const login = document.getElementById("login-form");
  if (login) {
    login.addEventListener("submit", async (e)=>{
      e.preventDefault();
      $("#msg").textContent = "Accesso in corso…";
      try {
        const fd = new FormData(login);
        const payload = Object.fromEntries(fd.entries());
        const WORKER = await base();
        const j = await fetch(`${WORKER}/api/auth/login`, {
          method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload),
          credentials:"include"
        }).then(r=>r.json());
        if (!j.ok) throw new Error(j.error || "Credenziali non valide");
        $("#msg").textContent = "Bentornato!";
        setTimeout(()=> location.href = redirect, 300);
      } catch (err) { $("#msg").textContent = err.message; }
    });
    document.getElementById("google-btn")?.addEventListener("click", async ()=>{
      const WORKER = await base();
      location.href = `${WORKER}/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
    });
  }
})();