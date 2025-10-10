// assets/js/account.js — fix base API to avoid /api/api/*
// We assume same-origin Worker mounted under /api.
// If you changed it, update workerBase in config/app.json or here.

(function(){
  const ABSOLUTE_RE = /^https?:\/\//i;
  const cfgPromise = (window.__ERGODIKA_READY || Promise.resolve(window.__ERGODIKA || {}))
    .catch(() => ({}));
  const remoteFallback = 'https://api.ergodika.it/api';
  const LOCAL_WORKER_BASE = '/api';
  let workerBase = LOCAL_WORKER_BASE;

  function ensureErgodikaObject() {
    if (!window.__ERGODIKA || typeof window.__ERGODIKA !== 'object') {
      window.__ERGODIKA = {};
    }
    return window.__ERGODIKA;
  }

  function updateWorkerBase(next) {
    workerBase = String(next || LOCAL_WORKER_BASE).replace(/\/$/, '') || LOCAL_WORKER_BASE;
    ensureErgodikaObject().workerBase = workerBase;
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

  if (location.hostname.endsWith('ergodika.it') && location.hostname !== 'api.ergodika.it') {
    updateWorkerBase(remoteFallback);
  } else {
    updateWorkerBase(workerBase);
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
      updateWorkerBase(LOCAL_WORKER_BASE);
    } else if (resolved) {
      updateWorkerBase(resolved);
    }
    if (!target.workerBase) {
      target.workerBase = workerBase;
    }
  });

  async function ensureConfig() {
    try {
      await cfgPromise;
    } catch (_) {
      /* ignore */
    }
  }

  // helper to safely join paths without // or missing /
  const joinApi = (base, p) => base + '/' + String(p || '').replace(/^\//, '');
  const api = (p) => joinApi(workerBase, p);

  async function getJSON(path, opts = {}, attempt = 0, base = workerBase) {
    await ensureConfig();
    const url = joinApi(base, path);
    let r;
    try {
      r = await fetch(url, { credentials: 'include', ...opts });
    } catch (err) {
      if (err && err.name === 'TypeError' && attempt === 0 && base !== LOCAL_WORKER_BASE && ABSOLUTE_RE.test(base)) {
        console.warn('Falling back to local', LOCAL_WORKER_BASE, 'after network error:', err);
        return getJSON(path, opts, attempt + 1, LOCAL_WORKER_BASE);
      }
      throw err;
    }

    const ct = r.headers.get('content-type') || '';

    if (!ct.includes('application/json')) {
      if (r.status === 404) {
        return null;
      }

      const body = await r.text().catch(() => '');
      throw new Error(`Unexpected response (${r.status}): ${ct || 'no content-type'}${body ? ` — ${body.slice(0, 120)}` : ''}`);
    }

    const j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || 'Request failed');
    return j;
  }

  // UI elements
  const elStatus = document.querySelector('[data-auth-status]');
  const elEmail  = document.querySelector('[data-auth-email]');
  const elAvatar = document.querySelector('[data-auth-avatar]');
  const btnLogout = document.querySelector('[data-auth-logout]');

  async function refreshMe(){
    try {
      await ensureConfig();
      const me = await getJSON('/auth/me');
      if (me && me.user) {
        if (elStatus) elStatus.textContent = 'Accesso effettuato';
        if (elEmail)  elEmail.textContent = me.user.email || '(senza email)';
        if (elAvatar && me.user.picture) {
          elAvatar.src = me.user.picture;
          elAvatar.hidden = false;
        }
        if (btnLogout) btnLogout.hidden = false;
      } else {
        if (elStatus) elStatus.textContent = 'Non risulti autenticato';
        if (btnLogout) btnLogout.hidden = true;
      }
    } catch (e) {
      console.error('auth/me error:', e);
      if (elStatus) elStatus.textContent = 'Errore nel recupero profilo';
    }
  }

  async function doLogout(){
    try {
      await ensureConfig();
      await getJSON('/auth/logout', { method: 'POST' });
      location.reload();
    } catch (e) {
      alert('Errore durante il logout');
    }
  }

  if (btnLogout) btnLogout.addEventListener('click', doLogout);

  // kick
  refreshMe();
})();
