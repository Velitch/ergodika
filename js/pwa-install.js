// PWA Install Module — Ergodika (Sept 2025)
/*
  Usage:
    <div id="pwa-install" data-mode="card"></div>
    import { mountPWAInstall } from './js/pwa-install.js';
    mountPWAInstall('#pwa-install');

  Modes:
    data-mode="card"   — inline card (good for sections/moduli)
    data-mode="floating" — floating button bottom-right
*/

let deferredPrompt = null;
let installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function isiOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isSafari(){
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
}
function canShowA2HS(){
  return !installed && ('BeforeInstallPromptEvent' in window) && !isiOS();
}

function buildUI(root){
  const mode = (root.getAttribute('data-mode') || 'card').toLowerCase();
  root.innerHTML = '';
  const wrap = document.createElement('div');
  if (mode === 'floating'){
    wrap.className = 'pwa-fab';
    wrap.innerHTML = `<button class="btn primary" type="button" aria-label="Installa app">Installa App</button>`;
  } else {
    wrap.className = 'card pwa-card';
    wrap.innerHTML = `
      <div class="row" style="justify-content:space-between;align-items:center">
        <div style="max-width:60ch">
          <strong>Installa l'app Ergodika</strong><br>
          <small class="muted">Aggiungi alla schermata Home per un'esperienza più veloce e offline.</small>
          <div class="pwa-status" role="status" aria-live="polite"></div>
        </div>
        <div class="row">
          <button class="btn primary" type="button">Installa</button>
          <button class="btn ghost pwa-dismiss" type="button">Nascondi</button>
        </div>
      </div>`;
  }
  root.appendChild(wrap);
  return wrap;
}

function showIOSHint(root){
  const hint = document.createElement('div');
  hint.className = 'card pwa-card';
  hint.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div style="max-width:60ch">
        <strong>Aggiungi alla Home su iOS</strong><br>
        <small class="muted">Apri con Safari, poi tocca <span aria-label="condividi">⎋</span> e scegli <em>Aggiungi a Home</em>.</small>
      </div>
      <div class="row">
        <button class="btn ghost pwa-dismiss" type="button">Ok</button>
      </div>
    </div>`;
  root.innerHTML = ''; root.appendChild(hint);
}

export function mountPWAInstall(selector='#pwa-install'){
  const root = (typeof selector === 'string') ? document.querySelector(selector) : selector;
  if (!root) return;

  if (installed){
    root.innerHTML = `<div class="badge">App già installata</div>`;
    return;
  }

  // iOS path: no beforeinstallprompt event
  if (isiOS() && isSafari()){
    showIOSHint(root);
    root.addEventListener('click', e => { if (e.target.closest('.pwa-dismiss')) root.remove(); });
    return;
  }

  const wrap = buildUI(root);
  const btn = wrap.querySelector('button.btn.primary');
  const dismiss = wrap.querySelector('.pwa-dismiss');
  const statusEl = wrap.querySelector('.pwa-status');

  if (dismiss){ dismiss.addEventListener('click', ()=> root.remove()); }

  window.addEventListener('appinstalled', () => {
    installed = true;
    if (statusEl) statusEl.textContent = 'Installata!';
    setTimeout(()=> root.remove(), 1200);
  });

  // If prompt already captured
  if (deferredPrompt){
    btn?.addEventListener('click', async () => {
      statusEl && (statusEl.textContent = '');
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted'){
        statusEl && (statusEl.textContent = 'Installazione avviata…');
      } else {
        statusEl && (statusEl.textContent = 'Installazione annullata');
      }
    });
    wrap.classList.add('pwa-ready');
    return;
  }

  // Wait for event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    wrap.classList.add('pwa-ready');
    // Attach click now that we have the event
    btn?.addEventListener('click', async () => {
      statusEl && (statusEl.textContent = '');
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted'){
        statusEl && (statusEl.textContent = 'Installazione avviata…');
      } else {
        statusEl && (statusEl.textContent = 'Installazione annullata');
      }
    }, { once:true });
  }, { once:true });
}
