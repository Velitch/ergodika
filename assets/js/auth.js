// assets/js/auth.js — Client-side auth helpers (no exports, safe for <script>)
// Assumes the API is same-origin under /api. If different, set window.__ERGODIKA.workerBase.
(function () {
  const ABSOLUTE_RE = /^https?:\/\//i;
  const cfgPromise = (window.__ERGODIKA_READY || Promise.resolve(window.__ERGODIKA || {}))
    .catch(() => ({}));
  const remoteFallback = 'https://api.ergodika.it/api';
  let workerBase = '/api';
  let remoteCandidate = null;
  let remoteAttempted = false;

  function ensureErgodikaObject() {
    if (!window.__ERGODIKA || typeof window.__ERGODIKA !== 'object') {
      window.__ERGODIKA = {};
    }
    return window.__ERGODIKA;
  }

  function updateWorkerBase(next) {
    workerBase = String(next || '/api').replace(/\/$/, '') || '/api';
    ensureErgodikaObject().workerBase = workerBase;
  }

  function registerRemoteCandidate(next) {
    const raw = String(next || '').trim();
    if (!raw) return;
    const normalized = raw.replace(/\/$/, '');
    if (!ABSOLUTE_RE.test(normalized)) return;
    remoteCandidate = normalized;
    ensureErgodikaObject().remoteWorkerBase = normalized;
  }

  function canUseRemoteFallback() {
    return !!remoteCandidate && !remoteAttempted && workerBase !== remoteCandidate;
  }

  function useRemoteFallback(reason) {
    if (!canUseRemoteFallback()) return false;
    remoteAttempted = true;
    if (reason) console.warn(reason);
    updateWorkerBase(remoteCandidate);
    return true;
  }

  function isLikelyLocalHost(hostname) {
    if (!hostname) return true;
    const lower = hostname.toLowerCase();
    if (lower === 'localhost' || lower === '127.0.0.1' || lower === '0.0.0.0') return true;
    if (lower.endsWith('.local')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) return true;
    return false;
  }

  function shouldForceLocal(base) {
    if (!ABSOLUTE_RE.test(base)) return false;
    if (base.startsWith(location.origin)) return false;
    if (location.protocol === 'file:') return true;
    return isLikelyLocalHost(location.hostname);
  }

  updateWorkerBase(workerBase);

  if (location.hostname.endsWith('ergodika.it') && location.hostname !== 'api.ergodika.it') {
    registerRemoteCandidate(remoteFallback);
  }

  cfgPromise.then((cfg) => {
    const target = ensureErgodikaObject();
    if (cfg && typeof cfg === 'object') {
      Object.assign(target, cfg);
    }
    const resolved = (cfg && typeof cfg === 'object' && cfg.workerBase)
      ? String(cfg.workerBase).replace(/\/$/, '')
      : workerBase;
    if (shouldForceLocal(resolved)) {
      updateWorkerBase('/api');
    } else if (ABSOLUTE_RE.test(resolved) && resolved !== '/api') {
      registerRemoteCandidate(resolved);
    } else if (resolved) {
      updateWorkerBase(resolved);
    }
    target.workerBase = workerBase;
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
  async function getJSON(path, opts = {}, attempt = 0) {
    await ensureConfig();
    const url = api(path);
    const r = await fetch(url, { credentials: 'include', ...opts }).catch((err) => {
      if (err && err.name === 'TypeError' && attempt === 0) {
        if (workerBase !== '/api' && ABSOLUTE_RE.test(workerBase)) {
          console.warn('Falling back to local /api after network error:', err);
          updateWorkerBase('/api');
          remoteAttempted = false;
          return null;
        }
        if (workerBase === '/api' && canUseRemoteFallback()) {
          useRemoteFallback('Retrying request against remote API after local network error');
          return null;
        }
      }
      throw err;
    });

    if (!r) {
      return getJSON(path, opts, attempt + 1);
    }
    if (r.status === 404 && workerBase === '/api' && canUseRemoteFallback()) {
      useRemoteFallback('Retrying request against remote API after 404 on local endpoint');
      return getJSON(path, opts, attempt + 1);
    }
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
      await getJSON('/auth/register', {
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
      await getJSON('/auth/login', {
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
