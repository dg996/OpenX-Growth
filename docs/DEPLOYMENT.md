# Deployment guide

1. Fork the repository and keep it private while configuring secrets.
2. Copy `.env.example` to `.env.local` for local development only.
3. Generate independent values for `SESSION_SECRET`, `APP_ACCESS_TOKEN`, `CRON_SECRET` and `OPENX_API_TOKEN`.
4. Create and migrate a D1 database.
5. Configure a dedicated X application with the exact production callback URL.
6. Deploy, sign in with `APP_ACCESS_TOKEN`, then authorize X.
7. Configure a scheduler only after a manual draft and publish test succeeds.
8. Leave AI and evergreen flags false until the associated policy review is complete.

## Release validation

```bash
npm ci
npm run release:check
git status --short
```

Confirm that Git contains no `.env`, `wrangler.jsonc`, `.openai/hosting.json`, database, export, private screenshot or log. Scan full history with Gitleaks before making a previously private fork public.

## Recovery

- Revoke X authorization and rotate all secrets after suspected disclosure.
- Restore D1 from an operator-managed backup; exports omit credentials.
- Changing `SESSION_SECRET` makes stored OAuth ciphertext unreadable and requires reconnection.
- Disable the scheduler before repairing repeated publishing failures.
