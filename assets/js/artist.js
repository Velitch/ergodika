(async function(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id') || '';
  if (!id) { document.body.innerHTML = '<p style="padding:2rem">Artista non trovato.</p>'; return; }

  async function base() {
    const cfg = await (await fetch("/config/app.json",{cache:"no-cache"})).json();
    return (cfg?.stripe?.workerBase || "").replace(/\/$/,"");
  }

  function linkIcon(href, label) {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = label;
    return a;
  }

  try {
    const WORKER = await base();
    const r = await fetch(`${WORKER}/api/artists/get?id=${encodeURIComponent(id)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Artist not found');

    const a = j.artist;
    document.title = `${a.name} — Ergodika`;
    document.getElementById('name').textContent = a.name;
    document.getElementById('bio').textContent = a.bio || '';
    document.getElementById('avatar').src = a.avatarUrl || '/assets/images/icon-192.png';
    document.getElementById('banner').src = a.bannerUrl || '/assets/images/icon-512.png';

    const links = document.getElementById('links');
    links.innerHTML = '';
    if (a.links?.website) links.appendChild(linkIcon(a.links.website, 'Sito'));
    if (a.links?.spotify) links.appendChild(linkIcon(a.links.spotify, 'Spotify'));
    if (a.links?.youtube) links.appendChild(linkIcon(a.links.youtube, 'YouTube'));
    if (a.links?.instagram) links.appendChild(linkIcon(a.links.instagram, 'Instagram'));

    document.querySelectorAll('[data-donate]').forEach(btn => {
      btn.dataset.artist = a.artistId;
    });
    if (window.ErgodikaPayments?.bindDonationButtons) {
      window.ErgodikaPayments.bindDonationButtons('[data-donate]');
    }
  } catch (e) {
    document.body.innerHTML = `<p style="padding:2rem">Errore: ${e.message}</p>`;
  }
})();
