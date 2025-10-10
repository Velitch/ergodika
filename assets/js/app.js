
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/config/app.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('Impossibile caricare /config/app.json:', e);
    return {};
  }
}

window.ERG = { config: null };

// Espone una promise globale in modo che altri script possano attendere la config.
const configPromise = loadConfig().then((cfg) => {
  window.ERG.config = cfg;
  window.__ERGODIKA = cfg;
  return cfg;
}).catch((err) => {
  console.warn('Config promise rejected:', err);
  window.ERG.config = {};
  window.__ERGODIKA = {};
  return {};
});

window.__ERGODIKA_READY = configPromise;
