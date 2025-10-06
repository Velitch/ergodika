// PWA install banner + iOS hint + update toast
(function () {
  let deferredPrompt = null;

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || (window.navigator.standalone === true);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  // UI builder
  function ensureBar() {
    if (document.getElementById('pwa-install-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'pwa-install-bar';
    bar.innerHTML = `
      <div style="flex:1">
        <div class="title">Installa Ergodika</div>
        <div class="hint" id="pwa-hint">Aggiungila alla schermata Home per un’esperienza migliore.</div>
      </div>
      <button id="pwa-install-btn">Installa</button>
      <button id="pwa-dismiss" class="ghost" aria-label="Chiudi">✕</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('pwa-dismiss').addEventListener('click', () => {
      bar.classList.remove('show');
      localStorage.setItem('pwa:dismissed', '1');
    });

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        bar.classList.remove('show');
        localStorage.setItem('pwa:dismissed', '1');
      } else if (isIOS) {
        // iOS: niente prompt — mostra istruzioni
        alert("Su iPhone: • Tocca il pulsante Condividi • Scegli 'Aggiungi alla schermata Home'");
      }
    });
  }

  function showBar() {
    if (localStorage.getItem('pwa:dismissed') === '1') return;
    ensureBar();
    document.getElementById('pwa-install-bar').classList.add('show');
    // Testo iOS
    if (isIOS) {
      document.getElementById('pwa-hint').textContent =
        "Su iPhone: Condividi → Aggiungi alla schermata Home";
      document.getElementById('pwa-install-btn').textContent = "Come si fa";
    }
  }

  // Prompt (Chrome/Edge/Android/Desktop)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isStandalone) showBar();
  });

  // Install avvenuta
  window.addEventListener('appinstalled', () => {
    localStorage.removeItem('pwa:dismissed');
    const bar = document.getElementById('pwa-install-bar');
    if (bar) bar.classList.remove('show');
  });

  // Se iOS standalone mancante: mostra hint una volta
  window.addEventListener('load', () => {
    if (!isStandalone && isIOS && isSafari) {
      // Mostra hint dopo 1.5s
      setTimeout(() => showBar(), 1500);
    }
  });

  // Aggiornamento SW → messaggio semplice
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Piccolo toast
      const t = document.createElement('div');
      t.textContent = 'App aggiornata';
      Object.assign(t.style, {
        position:'fixed',left:'50%',transform:'translateX(-50%)',bottom:'16px',
        background:'#0b1f2a',color:'#fff',padding:'8px 12px',borderRadius:'999px',zIndex:9999
      });
      document.body.appendChild(t);
      setTimeout(()=>t.remove(), 2500);
    });
  }
})();
