# Deployment guide

## Recommended first installation

For a normal Cloudflare installation, clone your fork and run only:

```bash
npm ci
npm run setup
```

During the wizard, approve the Cloudflare browser login, press Enter for the recommended `workers.dev` address, and either paste `X_CLIENT_ID` or press Enter to configure X later. Leave `X_CLIENT_SECRET` empty unless X explicitly provided one. Re-run `npm run setup` after any interruption; completed resources and existing data are preserved.

The wizard creates or reuses D1 without deleting data, applies migrations, deploys the Worker, writes generated values only to the gitignored `.env.local` with mode `600`, uploads missing secrets through Wrangler stdin, and verifies the protected instance. Existing remote secrets are never rotated automatically.

After **Setup complete**:

1. Open the application address printed in the terminal.
2. Sign in with `APP_ACCESS_TOKEN` from the local `.env.local` and store it in a password manager.
3. Open **Settings → X account**, save the X OAuth credentials, then click **Continue with X**.
4. Approve X and run the first read-only sync from **Discover**.

After deployment, use the application's **Settings** page for normal configuration. X credentials, OpenRouter/OpenAI settings, evergreen behavior, cache duration, local limits, scheduler secret, API token and application access token can be updated there without the Cloudflare dashboard or a redeploy. Secret values are encrypted in D1 and never returned after saving. `SESSION_SECRET` remains in the deployment secret store because it is the encryption root; `APP_URL` remains deployment-owned because it defines the public OAuth origin.

> **Stop here when the guided installer succeeds.** Do not copy `.env.example`, generate secrets, create D1 or run migrations again.

## Manual installation or recovery (advanced)

Use this checklist only when intentionally installing without `npm run setup` or repairing a failed wizard step:

1. Keep the fork private while configuring secrets.
2. Copy `.env.example` to `.env.local` for local development only.
3. Generate independent values for `SESSION_SECRET`, `APP_ACCESS_TOKEN`, `CRON_SECRET` and `OPENX_API_TOKEN`.
4. Create and migrate a D1 database bound exactly as `DB`; `openx_growth` is not a compatible binding name.
5. Configure a dedicated X application with the exact production callback URL.
6. Deploy, sign in, and authorize X from **Settings → X account**.
7. Configure a scheduler only after a draft and an intentional manual publish test succeed.
8. Leave AI and evergreen disabled until the associated policy review is complete.

See the complete environment-variable table in the [README](../README.md#3-configure-environment-variables). `.env.local` supports local development, bootstrap and resumable setup.

`APP_ACCESS_TOKEN` may be omitted only for an unconfigured, write-disabled demo. A configured instance without it fails closed; `OPENX_API_TOKEN` and `CRON_SECRET` cannot bypass that deployment gate or authenticate browser routes.

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
