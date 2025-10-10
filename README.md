
# Ergodika — PWA Pack (Base Completa)
Questa è la **struttura completa** della PWA pronta per GitHub Pages.

## Pubblicazione
1. Carica tutti i file nella **root** del tuo repository GitHub.
2. Attiva **GitHub Pages** sulla branch principale.
3. Visita l’URL e installa la PWA dal browser.

## Configurazioni
- `config/app.json`
  - `workerBase`: URL base dell'API (es. `https://api.tuosito.it/api` per un Worker su sottodominio)
  - `stripe.publicKey`: la tua `pk_test_...`
  - `stripe.workerBase`: URL del tuo Cloudflare Worker
  - `radio.streamUrl`: URL AzuraCast (es. https://.../live)

## Endpoint Worker da implementare
- `POST /api/checkout/one-time` (donazioni/acquisti una tantum)
- `POST /api/checkout/subscription` (abbonamenti ricorrenti)
- `GET /api/payments/artist-onboarding` (Stripe Connect Express)
- `GET /api/payments/artist-status` (stato collegamento)
- `POST /api/stripe/webhook` (entitlements/contatori)

## Pagine incluse
- `index.html` — Home
- `pages/manifesto.html` — Donazioni 1/3/5€ (placeholder)
- `pages/radio.html` — Player H24
- `pages/members.html` — Piani ricorrenti (placeholder)
- `pages/artist-onboarding.html` — Collegamento Stripe per artisti

Pronto per essere esteso con Smart Gateway, DSP whitelist e dashboard avanzate.
