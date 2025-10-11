// Ergodika Fresh — ES module
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

// Theme toggle
(function() {
  const root = document.documentElement;
  const saved = localStorage.getItem('theme');
  if (saved) root.setAttribute('data-theme', saved);
  const btn = document.querySelector('.theme-toggle');
  const sync = () => btn && (btn.textContent = (root.getAttribute('data-theme') === 'light') ? 'Tema: Dark' : 'Tema: Light');
  sync();
  btn?.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    sync();
  });
})();

// Smooth scroll
$$('a[href^=\"#\"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const t = document.getElementById(id);
    if (t) {
      e.preventDefault();
      t.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
      history.pushState(null, '', `#${id}`);
    }
  });
});

// Mini visualizer (fake animation; plug real analyser later)
export function attachMiniViz(canvas) {
  const ctx = canvas.getContext('2d');
  const setSize = () => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  };
  const bars = new Array(24).fill(0);
  let raf;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width / bars.length;
    bars.forEach((_, i) => {
      const v = Math.max(0.05, (Math.sin((Date.now() / 180) + (i * 0.5)) * 0.5 + 0.5) * 0.9);
      bars[i] = v;
      const h = v * canvas.height;
      const x = i * w + 2;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-1') || '#2EB6FF';
      ctx.fillRect(x, canvas.height - h, w - 4, h);
    });
    raf = requestAnimationFrame(draw);
  }
  const ro = new ResizeObserver(setSize);
  ro.observe(canvas);
  setSize();
  draw();
  return () => cancelAnimationFrame(raf);
}

// Map stub
export function initMap(id, {
  lat = 41.9,
  lng = 12.5,
  zoom = 12
} = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'absolute',
    inset: '0',
    display: 'grid',
    placeItems: 'center'
  });
  const pin = document.createElement('div');
  pin.textContent = '📍';
  pin.style.fontSize = '28px';
  wrap.appendChild(pin);
  el.appendChild(wrap);
  el.dataset.center = `${lat},${lng}`;
  el.dataset.zoom = zoom;
}

// Newsletter demo
(function() {
  const form = document.getElementById('newsletter-form');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const email = new FormData(form).get('email') + '';
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const st = document.getElementById('newsletter-status');
    if (!ok) {
      st.textContent = 'Email non valida';
      st.className = 'alert';
      return;
    }
    const list = JSON.parse(localStorage.getItem('newsletter') || '[]');
    if (!list.includes(email)) list.push(email);
    localStorage.setItem('newsletter', JSON.stringify(list));
    st.textContent = 'Iscritto! (demo locale)';
    st.className = 'badge';
    form.reset();
  });
})();

export function toast(msg) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    Object.assign(host.style, {
      position: 'fixed',
      bottom: '16px',
      right: '16px',
      display: 'grid',
      gap: '8px',
      zIndex: 80
    });
    document.body.appendChild(host);
  }
  const n = document.createElement('div');
  n.className = 'badge';
  n.textContent = msg;
  host.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}


/* SW Registration */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}



/* === Mobile nav full-screen === */
(function() {
    const btn = document.querySelector('.hamburger');
    if (!btn) return;

    // Crea drawer se non esiste
    let drawer = document.getElementById('mobile-menu');
    if (!drawer) {
      drawer = document.createElement('nav');
      drawer.id = 'mobile-menu';
      drawer.className = 'nav-drawer';

      // Header drawer: brand + close
      const head = document.createElement('div');
      head.className = 'nav-head';
      head.innerHTML = `
      <div class="brand"><img src="./assets/favicon-96x96.png" width="24" height="24" alt=""> <strong>ERGODIKA</strong></div>
      <button class="close" type="button" aria-label="Chiudi menu"><span class="bars"></span></button>
    `;
      drawer.appendChild(head);

      // Link clonati dalla prima .nav-links
      const src = document.querySelector('.nav-links');
      const list = document.createElement('div');
      list.className = 'nav-list';
      if (src) {
        Array.from(src.querySelectorAll('a')).forEach(a => {
          const link = document.createElement('a');
          link.href = a.getAttribute('href') || '#';
          link.textContent = (a.textContent || '').trim();
          list.appendChild(link);
        });
      } else {
        list.innerHTML = `<a href="index.html">Home</a><a href="dark-event.html">Dark</a><a href="light-corsi.html">Light</a>`;
      }
      drawer.appendChild(list);
      document.body.appendChild(drawer);
    }

    const closeBtn = drawer.querySelector('.close');
    const firstFocusable = () => drawer.querySelector('a,button,[tabindex]:not([tabindex="-1"])');

    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const trap = (e) => {
      if (!drawer.classList.contains('open')) return;
      if (!drawer.contains(e.target)) {
        (firstFocusable() || closeBtn).focus();
        e.stopPropagation();
      }
    };

    function open() {
      drawer.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      (firstFocusable() || closeBtn).focus();
      document.addEventListener('keydown', onKey);
      document.addEventListener('focus', trap, true);
    }

    function close() {
      drawer.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focus', trap, true);
    }

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      expanded ? close() : open();
    });
    closeBtn.addEventListener('click', close);
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('a')) close();
    });
  })();
})();

// Copy-to-clipboard per email (opzionale)
(function() {
  const mail = document.querySelector('a[href^="mailto:"]');
  if (!mail) return;
  mail.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey) return; // lascia passare se vogliono aprire il client
    e.preventDefault();
    const text = mail.textContent.trim();
    navigator.clipboard?.writeText(text).then(() => {
      window.toast && window.toast('Email copiata');
    });
  });
})();
