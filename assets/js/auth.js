// assets/js/auth.js — Client-side auth helpers (no exports, safe for <script>)
// Assumes the API is same-origin under /api. If different, set window.__ERGODIKA.workerBase.
(function () {
  const cfgPromise = (window.__ERGODIKA_READY || Promise.resolve(window.__ERGODIKA || {}))
    .catch(() => ({}));
  let workerBase = '/api';

  cfgPromise.then((cfg) => {
    if (cfg && typeof cfg === 'object' && cfg.workerBase) {
      workerBase = String(cfg.workerBase).replace(/\/$/, '') || '/api';
    }
    if (!window.__ERGODIKA || typeof window.__ERGODIKA !== 'object') {
      window.__ERGODIKA = cfg || {};
    }
  });

  async function ensureConfig() {
    try {
      await cfgPromise;
    } catch (_) {
      /* noop */
    }
  }

  const api = (p) => workerBase + '/' + String(p || '').replace(/^\//, '');

  /* ----------------------------- Utilities ----------------------------- */
  async function getJSON(url, opts = {}) {
    await ensureConfig();
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
  async function startGoogle(redirect) {
    try {
      await ensureConfig();
      const dest = redirect || qs.get('redirect') || '/pages/account.html';
      const url = api('/auth/google/start') + '?redirect=' + encodeURIComponent(dest);
      location.href = url;
    } catch (err) {
      console.error('Errore durante startGoogle:', err);
      alert('Impossibile contattare il servizio di autenticazione. Riprova più tardi.');
    }
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
      await ensureConfig();
      const url = api('/auth/register');
      await getJSON(url, {
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
      await ensureConfig();
      const url = api('/auth/login');
      await getJSON(url, {
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
    if (g1) g1.addEventListener('click', () => { void startGoogle('/pages/account.html'); });

    const reg = document.getElementById('signupForm');
    if (reg) reg.addEventListener('submit', onRegister);

    const log = document.getElementById('loginForm');
    if (log) log.addEventListener('submit', onLogin);
  });

  /* --------------------------- Expose minimal -------------------------- */
  window.ErgAuth = {
    startGoogle,
    get apiBase() {
      return workerBase;
    }
  };
})();
