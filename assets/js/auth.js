// assets/js/auth.js — Client-side auth helpers (no exports, safe for <script>)
// Assumes the API is same-origin under /api. If different, set window.__ERGODIKA.workerBase.
(function () {
  const cfg = window.__ERGODIKA || {};
  const workerBase = (cfg.workerBase || '/api').replace(/\/$/, '');
  const api = (p) => workerBase + '/' + String(p || '').replace(/^\//, '');

  /* ----------------------------- Utilities ----------------------------- */
  async function getJSON(url, opts = {}) {
    const r = await fetch(url, { credentials: 'include', ...opts });
    const ct = r.headers.get('content-type') || '';
    let body = null;
    try { body = ct.includes('application/json') ? await r.json() : { ok:false, error:'Unexpected content' }; }
    catch { body = { ok:false, error:'Bad JSON' }; }
    if (!r.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + r.status));
    return body;
  }
  const qs = new URLSearchParams(location.search);

  /* ----------------------- Google OAuth (Start) ------------------------ */
  function startGoogle(redirect) {
    const dest = redirect || qs.get('redirect') || '/pages/account.html';
    const url = api('/auth/google/start') + '?redirect=' + encodeURIComponent(dest);
    location.href = url;
  }

  /* -------------------- Email/Password (optional) --------------------- */
  async function onRegister(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const data = {
      email: f.querySelector('input[name="email"]')?.value || '',
      password: f.querySelector('input[name="password"]')?.value || ''
    };
    try {
      await getJSON(api('/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      location.href = '/pages/account.html';
    } catch (err) {
      alert('Registrazione fallita: ' + err.message);
    }
  }

  async function onLogin(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const data = {
      email: f.querySelector('input[name="email"]')?.value || '',
      password: f.querySelector('input[name="password"]')?.value || ''
    };
    try {
      await getJSON(api('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      location.href = '/pages/account.html';
    } catch (err) {
      alert('Accesso fallito: ' + err.message);
    }
  }

  /* --------------------------- Bind UI hooks -------------------------- */
  window.addEventListener('DOMContentLoaded', () => {
    const g1 = document.querySelector('[data-google-login]');
    if (g1) g1.addEventListener('click', () => startGoogle('/pages/account.html'));

    const reg = document.getElementById('signupForm');
    if (reg) reg.addEventListener('submit', onRegister);

    const log = document.getElementById('loginForm');
    if (log) log.addEventListener('submit', onLogin);
  });

  /* --------------------------- Expose minimal -------------------------- */
  window.ErgAuth = {
    startGoogle,
    apiBase: workerBase
  };
})();