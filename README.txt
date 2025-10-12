ERGODIKA EVENTS — README (setup rapido)
1) Aggiorna wrangler.toml (vars + ID KV/D1/R2).
2) Inizializza DB: `wrangler d1 execute ergodika --file worker/migrations.sql`
3) Deploy: `wrangler deploy`
4) Seed: POST /api/init sul tuo Worker.
5) Frontend: apri /events.html (modifica API_BASE nei file). Checkout → Stripe → success.html emette biglietto.
6) Auth: /dashboard.html per link magico (Resend). Promuovi admin in D1.
7) Membership: /membership.html → Stripe subscription; portal via API.
8) Materiali (R2) con policy; download controlla membership/ticket.
9) Reminder: cron H-24/H-2 + trigger /admin/events/remind.
