// assets/js/account.js — fix base API to avoid /api/api/*
// We assume same-origin Worker mounted under /api.
// If you changed it, update workerBase in config/app.json or here.

(function(){
  const cfg = window.__ERGODIKA || {};
  const workerBase = (cfg.workerBase || '/api').replace(/\/$/, ''); // '/api' (no trailing slash)

  // helper to safely join paths without // or missing /
  const api = (p) => workerBase + '/' + String(p || '').replace(/^\//, '');

  async function getJSON(url, opts = {}) {
    const r = await fetch(url, { credentials: 'include', ...opts });
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Unexpected content-type: ' + ct);
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
      const me = await getJSON(api('/auth/me'));
      if (me.user) {
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
      await getJSON(api('/logout'), { method: 'POST' });
      location.reload();
    } catch (e) {
      alert('Errore durante il logout');
    }
  }

  if (btnLogout) btnLogout.addEventListener('click', doLogout);

  // kick
  refreshMe();
})();