// PWA install banner + iOS hint + pulsante "Installa app"
(function () {
  let deferredPrompt = null;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || (window.navigator.standalone === true);
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  /* ---------- UI: barra suggerimento (facoltativa) ---------- */
  function ensureBar() {
    if (document.getElementById('pwa-install-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'pwa-install-bar';
    bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;display:flex;align-items:center;gap:10px;background:#0b1f2a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 12px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,.36);opacity:1;";
    bar.innerHTML = `
      <div style="flex:1">
        <div class="title" style="font-weight:800">Installa Ergodika</div>
        <div class="hint" id="pwa-hint" style="opacity:.85;font-size:.9rem">Aggiungila alla schermata Home per un’esperienza migliore.</div>
      </div>
      <button id="pwa-install-btn" style="appearance:none;border:none;border-radius:999px;padding:8px 12px;cursor:pointer;font-weight:700;background:#2563eb;color:#fff">Installa</button>
      <button id="pwa-dismiss" class="ghost" aria-label="Chiudi" style="appearance:none;border:none;border-radius:999px;padding:8px 12px;cursor:pointer;font-weight:700;background:transparent;color:#fff;opacity:.8">✕</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('pwa-dismiss').addEventListener('click', () => {
      bar.remove();
      localStorage.setItem('pwa:dismissed', '1');
    });

    document.getElementById('pwa-install-btn').addEventListener('click', () => installAction());
  }

  function showBar() {
    if (localStorage.getItem('pwa:dismissed') === '1') return;
    ensureBar();
    if (isIOS) {
      const hint = document.getElementById('pwa-hint');
      const btn = document.getElementById('pwa-install-btn');
      if (hint) hint.textContent = "Su iPhone: Condividi → Aggiungi alla schermata Home";
      if (btn) btn.textContent = "Come si fa";
    }
  }

  /* ---------- Pulsante di install manuale ---------- */
  function enableTriggers() {
    document.querySelectorAll('[data-install-pwa]').forEach(btn => {
      btn.removeAttribute('disabled');
      btn.style.display = '';
    });
  }
  function hideTriggers() {
    document.querySelectorAll('[data-install-pwa]').forEach(btn => {
      btn.setAttribute('hidden', 'hidden');
      btn.style.display = 'none';
    });
  }
  async function installAction() {
    // Android/Desktop: prompt disponibile
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch {}
      deferredPrompt = null;
      localStorage.setItem('pwa:dismissed', '1');
      const bar = document.getElementById('pwa-install-bar');
      if (bar) bar.remove();
      return;
    }
    // iOS: mostra istruzioni
    if (isIOS && !isStandalone) {
      alert("Su iPhone:\n• Tocca il pulsante Condividi\n• Scegli 'Aggiungi alla schermata Home'");
      return;
    }
    // Fallback: mostra la barra suggerimento se non installata
    if (!isStandalone) showBar();
  }

  function bindTriggers() {
    document.querySelectorAll('[data-install-pwa]').forEach(btn => {
      btn.addEventListener('click', installAction);
    });
    // se già installata, nascondi
    if (isStandalone) hideTriggers();
    // su iOS non c'è beforeinstallprompt → lascia visibile per mostrare le istruzioni
    if (isIOS && !isStandalone) enableTriggers();
  }

  /* ---------- Eventi PWA ---------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    enableTriggers();          // abilita pulsante manuale
    if (!isStandalone) showBar(); // mostra anche la barra (facoltativo)
  });

  window.addEventListener('appinstalled', () => {
    localStorage.removeItem('pwa:dismissed');
    hideTriggers();
    const bar = document.getElementById('pwa-install-bar');
    if (bar) bar.remove();
  });

  window.addEventListener('load', () => {
    bindTriggers();
    // Aggiornamento PWA: register + prompt + SKIP_WAITING + toast
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' })
        .then(reg => {
          // Controlla subito e periodicamente
          reg.update();
          setInterval(() => reg.update(), 60 * 60 * 1000);

          function promptUpdate() {
            // qui puoi usare un tuo banner/overlay al posto del confirm()
            const ok = confirm('È disponibile un aggiornamento di Ergodika. Vuoi aggiornare ora?');
            if (ok && reg.waiting) {
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
          }

          // Se c'è già un worker in "waiting" (nuova versione pronta)
          if (reg.waiting) promptUpdate();

          // Quando arriva una nuova versione…
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                // nuova versione installata, vecchia ancora in uso → proponi update
                promptUpdate();
              }
            });
          });

          // Quando la nuova versione prende il controllo
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            // toast "App aggiornata" + reload dolce
            const t = document.createElement('div');
            t.textContent = 'App aggiornata';
            Object.assign(t.style, {
              position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'16px',
              background:'#0b1f2a',color:'#fff',padding:'8px 12px',borderRadius:'999px',zIndex:9999
            });
            document.body.appendChild(t);
            setTimeout(() => { t.remove(); location.reload(); }, 800);
          });
        })
        .catch(() => {});
    }
  });

  // Esponi una piccola API globale (se vuoi richiamarla da altri script)
  window.ErgodikaPWA = {
    install: installAction
  };
})();