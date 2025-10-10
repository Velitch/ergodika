(function () {
  const STATE = {
    config: null,
    workerBase: '/api',
    prices: {},
  };

  const cfgPromise = (async () => {
    try {
      const res = await fetch('/config/app.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const cfg = await res.json();
      const stripe = cfg?.stripe || {};
      STATE.config = cfg;
      STATE.workerBase = String(stripe.workerBase || cfg.workerBase || '/api').replace(/\/$/, '') || '/api';
      STATE.prices = stripe.prices || {};
    } catch (err) {
      console.warn('[ErgodikaPayments] Config load failed:', err && err.message);
      STATE.config = {};
      STATE.workerBase = '/api';
      STATE.prices = {};
    }
    return STATE;
  })();

  async function ensureConfig() {
    if (!STATE.config) {
      await cfgPromise;
    }
    return STATE;
  }

  function api(path) {
    const suffix = String(path || '').startsWith('/') ? path : '/' + String(path || '');
    return STATE.workerBase + suffix;
  }

  async function postJson(path, payload) {
    await ensureConfig();
    const res = await fetch(api(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok || (body && body.ok === false)) {
      const err = body && (body.error || body.message);
      throw new Error(err || 'Richiesta non riuscita (' + res.status + ')');
    }
    return body || {};
  }

  function normalizeAmount(button) {
    const attr = button.getAttribute('data-amount-eur') ?? button.getAttribute('data-amount');
    if (!attr) return null;
    const raw = attr.trim();
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;

    if (button.hasAttribute('data-amount-eur')) {
      return Math.max(0.5, num);
    }

    // If the attribute looks like cents (e.g. 100 for 1 €) convert to euro.
    if (!raw.includes('.') && num >= 10) {
      return Math.max(0.5, num / 100);
    }

    return Math.max(0.5, num);
  }

  function resolvePriceId(button) {
    const direct = button.getAttribute('data-price-id') || button.getAttribute('data-price');
    if (direct && direct.startsWith('price_')) return direct.trim();

    const key = button.getAttribute('data-price-key')
      || button.getAttribute('data-sub-plan')
      || button.getAttribute('data-plan');
    if (key && STATE.prices[key]) return STATE.prices[key];

    const tier = button.getAttribute('data-sub-tier');
    if (tier) {
      if (STATE.prices[tier]) return STATE.prices[tier];
      const normalized = tier.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const fallbacks = [
        `price_${normalized}`,
        `plan_${normalized}`,
        `sub_${normalized}`,
        `tier_${normalized}`,
        normalized,
      ];
      for (const k of fallbacks) {
        if (STATE.prices[k]) return STATE.prices[k];
      }
      if (tier.startsWith('price_')) return tier;
    }

    return null;
  }

  async function handleDonation(button) {
    const amount = normalizeAmount(button);
    if (!amount) {
      alert('Importo donazione non valido.');
      return;
    }
    const artistId = button.getAttribute('data-artist') || '';
    if (!artistId) {
      alert('Artista non specificato per la donazione.');
      return;
    }
    const memo = button.getAttribute('data-memo')
      || `Supporto per ${artistId}`;

    const prevText = button.textContent;
    button.disabled = true;
    button.textContent = 'Reindirizzamento…';
    try {
      const data = await postJson('/checkout/one-time', {
        amount,
        artistId,
        memo,
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('URL checkout non ricevuto.');
      }
    } catch (err) {
      alert(err?.message || 'Donazione non riuscita.');
    } finally {
      button.disabled = false;
      button.textContent = prevText;
    }
  }

  async function handleSubscription(button) {
    const priceId = resolvePriceId(button);
    if (!priceId) {
      alert('Piano non configurato.');
      return;
    }
    const memo = button.getAttribute('data-memo') || 'Abbonamento Ergodika';

    const prevText = button.textContent;
    button.disabled = true;
    button.textContent = 'Reindirizzamento…';
    try {
      const data = await postJson('/checkout/subscription', {
        priceId,
        memo,
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('URL checkout non ricevuto.');
      }
    } catch (err) {
      alert(err?.message || 'Abbonamento non riuscito.');
    } finally {
      button.disabled = false;
      button.textContent = prevText;
    }
  }

  function bindDonationButtons(selector = '[data-donate]') {
    document.querySelectorAll(selector).forEach((button) => {
      if (button.__ergodikaDonateBound) return;
      button.__ergodikaDonateBound = true;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        void handleDonation(button);
      });
    });
  }

  function bindSubscriptionButtons(selector = '[data-sub-tier]') {
    document.querySelectorAll(selector).forEach((button) => {
      if (button.__ergodikaSubBound) return;
      button.__ergodikaSubBound = true;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        void handleSubscription(button);
      });
    });
  }

  function ready() {
    void ensureConfig();
    bindDonationButtons();
    bindSubscriptionButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }

  window.ErgodikaPayments = {
    ready: ensureConfig,
    bindDonationButtons,
    bindSubscriptionButtons,
    createDonationCheckout: (options) => postJson('/checkout/one-time', options || {}),
    createSubscriptionCheckout: (options) => postJson('/checkout/subscription', options || {}),
    get workerBase() {
      return STATE.workerBase;
    },
  };
})();
