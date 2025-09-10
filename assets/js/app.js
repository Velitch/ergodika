
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(console.error);
  });
}
async function loadConfig(){
  try{
    const res = await fetch('/config/app.json',{cache:'no-store'});
    return await res.json();
  }catch(e){ return {}; }
}
window.ERG = { config: null };
loadConfig().then(cfg => window.ERG.config = cfg);
