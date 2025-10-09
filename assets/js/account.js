(function() {
  async function getConfig() {
    try {
      const r = await fetch('/config/app.json', {
        cache: 'no-cache'
      });
      if (!r.ok) throw 0;
      return await r.json();
    } catch (e) {
      return {
        stripe: {
          workerBase: '/api'
        }
      };
    }
  }
  async function api(path, opt = {}) {
    const cfg = await getConfig();
    const base = (cfg?.stripe?.workerBase || '').replace(/\/$/, '');
    const res = await fetch(base + path, {
      credentials: 'include',
      ...opt
    });
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(c => {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  async function renderCta(user) {
    const host = document.getElementById('account-cta');
    if (!host) return;
    host.innerHTML = '';
    if (user) {
      host.appendChild(el('span', {
        class: 'account-chip'
      }, [
        el('span', {
          class: 'badge'
        }, 'Logged in'),
        el('span', {}, user.email || 'utente')
      ]));
      const menu = el('div', {
        class: 'account-menu'
      }, [
        el('a', {
          href: '/pages/account.html'
        }, 'Profilo'),
        el('a', {
          href: '#',
          id: 'cta-logout'
        }, 'Esci')
      ]);
      host.appendChild(menu);
      menu.querySelector('#cta-logout').addEventListener('click', async (e) => {
        e.preventDefault();
        await api('/api/auth/logout', {
          method: 'POST'
        });
        location.reload();
      });
    } else {
      const menu = el('div', {
        class: 'account-menu'
      }, [
        el('a', {
          href: '/pages/login.html?redirect=/pages/account.html'
        }, 'Accedi'),
        el('a', {
          href: '/pages/signup.html?redirect=/pages/account.html'
        }, 'Registrati')

      ]);
      host.appendChild(menu);
    }
  }

  async function renderAccountCard() {
    const card = document.getElementById('account-card');
    const actions = document.getElementById('actions');
    const me = await api('/api/auth/me');
    await renderCta(me?.user);
    if (!me?.ok || !me.user) {
      card.innerHTML = '<p>Non risulti autenticato. <a href="/pages/login.html">Accedi</a> o <a href="/pages/signup.html">crea un account</a>.</p>';
      actions.style.display = 'none';
      return;
    }
    const u = me.user;
    const googleLinked = !!u.google_sub;
    card.innerHTML = '';
    card.appendChild(el('div', {}, [
      el('div', {
        class: 'kv'
      }, [
        el('div', {
          class: 'k'
        }, 'Email'),
        el('div', {
          class: 'v'
        }, u.email || '-'),
        el('div', {
          class: 'k'
        }, 'Ruoli'),
        el('div', {
          class: 'v'
        }, Array.isArray(u.roles) ? u.roles.join(', ') : String(u.roles || '-')),
        el('div', {
          class: 'k'
        }, 'Google'),
        el('div', {
          class: 'v'
        }, googleLinked ? 'Collegato ✓' : 'Non collegato'),
        el('div', {
          class: 'k'
        }, 'Creato il'),
        el('div', {
          class: 'v'
        }, u.created_at ? new Date(u.created_at).toLocaleString() : '-')
      ]),
      el('p', {
        class: 'small',
        style: 'margin-top:12px;opacity:.8'
      }, 'Questa è la tua scheda profilo base. A breve qui potrai collegare il profilo artista, gestire abbonamenti e privacy.')
    ]));
    actions.style.display = '';
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      await api('/api/auth/logout', {
        method: 'POST'
      });
      location.href = '/';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAccountCard);
  } else {
    renderAccountCard();
  }
})();
