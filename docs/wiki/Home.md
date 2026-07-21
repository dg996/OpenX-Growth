# OpenX Growth Wiki

OpenX Growth is a self-hosted, open-source workspace to **discover ideas and reply opportunities**, **draft and schedule posts/threads**, and **track performance** using the official X API.

This wiki is the operator handbook: how to run it live, connect X safely, and troubleshoot common issues.

## First installation

For a normal Cloudflare installation, fork and clone the repository, then run:

```bash
npm ci
npm run setup
```

Approve the Cloudflare browser login and press Enter for the recommended `workers.dev` address. If your X application is not ready, press Enter when asked for X credentials; you can add them later in **Settings → X account**.

Wait for **Setup complete**, open the printed application address and sign in with `APP_ACCESS_TOKEN` from the local `.env.local`. The wizard creates the database, migrations, deployment files and installation secrets. Do not repeat those steps manually.

## Go live (connect your X account)

### 1) Create an X app

- Create an app in the X Developer Console (`https://console.x.com/`)
- Enable OAuth 2.0
- Set permissions to **Read and Write**
- Register the callback URL:

`https://YOUR_DOMAIN/api/x/oauth/callback`

### 2) Register the application addresses

Use the addresses displayed by OpenX:

- Website URL: the exact OpenX application address
- Callback URL: `https://YOUR_DOMAIN/api/x/oauth/callback`

### 3) Authorize via Settings

Open **Settings → X account**, paste the OAuth Client ID and optional Client Secret, and save. Click **Continue with X**, approve the permissions, then run the first read-only sync from **Discover**.

OpenRouter/OpenAI, evergreen behavior, cache duration, local limits and integration tokens are also changed from the application Settings page. They do not require the Cloudflare dashboard or a redeploy.

## Local demo or manual recovery

Copying `.env.example`, generating secrets and running database migrations manually are advanced paths for local development or recovery. They are not additional steps after a successful `npm run setup`. See the [README](../../README.md#manual-installation-and-recovery-advanced) and [deployment guide](../DEPLOYMENT.md#manual-installation-or-recovery-advanced).

## Daily limits and usage

OpenX enforces local budgets so one instance cannot accidentally exceed your plan:

- `MAX_DAILY_X_RESOURCES`
- `MAX_DAILY_X_WRITES`

Reads reserve worst-case resources before the call and reconcile to returned data.
Writes count every outbound attempt, including retries and failures.

## Publishing safety and `needs_review`

X post creation does not provide a global idempotency key.
If OpenX cannot prove whether X accepted a request (timeouts or 5xx), the item is moved to **`needs_review`** and is **never retried automatically**.

Use the UI reconciliation flow to confirm and continue safely.

## Data, privacy, and exports

- No telemetry to maintainers
- Exports exclude credentials and OAuth tokens
- Disconnecting X removes stored tokens

See `PRIVACY.md` for details.

## Security reporting

Do not open public issues for vulnerabilities.
Use GitHub’s private **Report a vulnerability** flow (requires “Private vulnerability reporting” enabled in repo settings).

See `SECURITY.md`.
