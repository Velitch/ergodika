(async function(){
  const params = new URLSearchParams(location.search);
  const artistId = params.get('id') || '';
  if (!artistId) { document.body.innerHTML = '<p style="padding:2rem">Artista non trovato.</p>'; return; }

  // --- Worker base ---
  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
  }

  // --- UI helpers ---
  const $ = (s) => document.querySelector(s);
  function linkIcon(href, label) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = label;
    return a;
  }

  // --- Token storage (per artista) ---
  const LS_KEY = (id) => `artist:${id}:token`;
  function loadToken(){ try { return localStorage.getItem(LS_KEY(artistId)) || ""; } catch { return ""; } }
  function saveToken(tok){ try { localStorage.setItem(LS_KEY(artistId), tok); } catch {} }
  function clearToken(){ try { localStorage.removeItem(LS_KEY(artistId)); } catch {} }

  // --- Stato corrente artista ---
  let artist = null;

  // --- Update UI dai dati artista ---
  function renderArtist(a){
    artist = a;
    document.title = `${a.name} — Ergodika`;
    $('#name').textContent = a.name || '—';
    $('#bio').textContent = a.bio || '';
    $('#avatar').src = a.avatarUrl || '/assets/images/icon-192.png';
    $('#banner').src = a.bannerUrl || '/assets/images/icon-512.png';

    const links = $('#links');
    links.innerHTML = '';
    if (a.links?.website) links.appendChild(linkIcon(a.links.website, 'Sito'));
    if (a.links?.spotify) links.appendChild(linkIcon(a.links.spotify, 'Spotify'));
    if (a.links?.youtube) links.appendChild(linkIcon(a.links.youtube, 'YouTube'));
    if (a.links?.instagram) links.appendChild(linkIcon(a.links.instagram, 'Instagram'));

    // Abilita donazioni su questo artista
    document.querySelectorAll('[data-donate]').forEach(btn => {
      btn.dataset.artist = a.artistId;
    });
    if (window.ErgodikaPayments?.bindDonationButtons) {
      window.ErgodikaPayments.bindDonationButtons('[data-donate]');
    }
  }

  // --- Modale Edit ---
  function openEdit(){
    // Prefill form dai dati correnti
    $('#f-name').value = artist?.name || '';
    $('#f-bio').value = artist?.bio || '';
    $('#f-avatar').value = artist?.avatarUrl || '';
    $('#f-banner').value = artist?.bannerUrl || '';
    $('#f-website').value = artist?.links?.website || '';
    $('#f-spotify').value = artist?.links?.spotify || '';
    $('#f-youtube').value = artist?.links?.youtube || '';
    $('#f-instagram').value = artist?.links?.instagram || '';
    // Token precompilato se presente
    const tok = loadToken();
    $('#f-token').value = tok || '';
    $('#f-remember').checked = !!tok;

    $('#edit-msg').textContent = '';
    $('#edit-modal').classList.add('show');
    $('#edit-modal').setAttribute('aria-hidden','false');
  }
  function closeEdit(){
    $('#edit-modal').classList.remove('show');
    $('#edit-modal').setAttribute('aria-hidden','true');
  }

  async function saveEdit(e){
    e.preventDefault();
    const token = ($('#f-token').value || '').trim();
    if (!token) { $('#edit-msg').textContent = 'Inserisci il token.'; return; }

    const payload = {
      artistId,
      token,
      name: $('#f-name').value.trim(),
      bio: $('#f-bio').value.trim(),
      avatarUrl: $('#f-avatar').value.trim(),
      bannerUrl: $('#f-banner').value.trim(),
      website: $('#f-website').value.trim(),
      spotify: $('#f-spotify').value.trim(),
      youtube: $('#f-youtube').value.trim(),
      instagram: $('#f-instagram').value.trim()
    };

    $('#edit-msg').textContent = 'Salvataggio…';
    try {
      const WORKER = await base();
      const r = await fetch(`${WORKER}/api/artists/update`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Errore salvataggio');

      // Ricorda token se richiesto
      if ($('#f-remember').checked) saveToken(token); else clearToken();

      // Aggiorna UI
      renderArtist(j.artist);
      $('#edit-msg').textContent = 'Salvato ✅';
      setTimeout(closeEdit, 600);
    } catch (err) {
      $('#edit-msg').textContent = `Errore: ${err.message}`;
    }
  }

  // --- Bind eventi UI ---
  function bindUI(){
    $('#edit-profile')?.addEventListener('click', openEdit);
    $('#edit-cancel')?.addEventListener('click', closeEdit);
    $('#edit-form')?.addEventListener('submit', saveEdit);
    // Chiudi modale clic esterno
    $('#edit-modal')?.addEventListener('click', (e)=>{ if (e.target.id === 'edit-modal') closeEdit(); });
    // Shortcut "esc"
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') closeEdit(); });
  }

  // --- Bootstrap ---
  try {
    const WORKER = await base();
    const r = await fetch(`${WORKER}/api/artists/get?id=${encodeURIComponent(artistId)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Artist not found');
    renderArtist(j.artist);
  } catch (e) {
    document.body.innerHTML = `<p style="padding:2rem">Errore: ${e.message}</p>`;
    return;
  }

  bindUI();
})();
