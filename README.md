# OpenX Growth

Open-source, self-hosted tools for growing on X without giving a third-party service your account credentials or content history.

OpenX Growth connects to the official X API, analyzes the accounts you follow and your own posts, helps you find relevant conversations, manages drafts and threads, schedules posts, records analytics snapshots, and optionally uses your own AI provider. Each user forks and deploys their own isolated instance.

> Status: early alpha. Review X pricing and policies before enabling write or AI features. This project is not affiliated with or endorsed by X Corp.

## Principles

- **Self-hosted:** your fork, database, X developer app and API bill.
- **Official APIs only:** no scraping or browser automation.
- **Human-controlled publishing:** no automatic replies or unsolicited DMs.
- **No telemetry:** the project sends data only to X and providers you configure.
- **Fork-first secrets:** credentials live in deployment secrets, never in the browser or repository.
- **Honest state:** the UI labels sample data as `DEMO DATA` and connected results as `LIVE FROM X`.

## Features

- OAuth 2.0 Authorization Code + PKCE with encrypted token storage.
- Home-timeline-based reply opportunities with explicit ranking reasons.
- Network-derived idea pillars, content-gap detection and feedback signals.
- Draft, single-post and thread editor.
- Persistent D1 content queue and protected scheduled publisher.
- Idempotent thread publishing with partial-progress recovery.
- Optional evergreen recycling with configurable intervals and a default-off policy gate.
- Analytics snapshots grouped by topic, format, hook and posting hour.
- Daily X API read/write budgets, caching and rate-limit protection.
- Light and dark themes; actionable notification center.
- JSON import/export with no credentials included.
- Optional OpenAI-compatible AI provider using your own API key.
- REST API and local MCP server for agent workflows.

## Architecture

```mermaid
flowchart TD
  UI[Web UI] --> API[Same-origin API]
  MCP[MCP server] --> API
  API --> D1[(Cloudflare D1)]
  API --> X[X API v2]
  API -. optional .-> AI[OpenAI-compatible provider]
  Cron[Protected scheduler] --> API
```

OAuth and refresh tokens are AES-GCM encrypted using `SESSION_SECRET` before D1 storage. Browser writes require a double-submit CSRF token. Automation and external API calls require separate bearer secrets.

## Requirements

- Node.js 22.13+
- An X developer account and application
- A Cloudflare Worker-compatible deployment with a D1 binding named `DB`
- X API credits for the endpoints you use

## 1. Fork and install

Fork this repository, then:

```bash
git clone https://github.com/YOUR_USERNAME/OpenX-Growth.git
cd OpenX-Growth
npm ci
cp .env.example .env.local
```

Generate independent secrets:

```bash
openssl rand -base64 48  # SESSION_SECRET
openssl rand -base64 32  # APP_ACCESS_TOKEN
openssl rand -base64 32  # CRON_SECRET
openssl rand -base64 32  # OPENX_API_TOKEN
```

Never reuse these values and never commit `.env.local`.

## 2. Create the X application

1. Open the [X Developer Console](https://console.x.com/).
2. Create a dedicated application for your OpenX fork.
3. Enable OAuth 2.0.
4. Set app permissions to **Read and Write**.
5. Register this exact callback URL:

```text
https://YOUR_DEPLOYMENT_HOST/api/x/oauth/callback
```

6. Set your website URL to the deployment origin.
7. Copy the OAuth 2.0 Client ID into `X_CLIENT_ID`.
8. If the X console treats your app as a confidential web client, also set `X_CLIENT_SECRET`. Public clients use PKCE without it.

OpenX requests only:

```text
tweet.read tweet.write users.read offline.access
```

## 3. Configure environment variables

See [.env.example](.env.example). At minimum, production needs:

```dotenv
APP_URL=https://YOUR_DEPLOYMENT_HOST
X_CLIENT_ID=your_oauth_2_client_id
SESSION_SECRET=a_random_value_with_at_least_32_characters
APP_ACCESS_TOKEN=a_separate_random_private_access_token
CRON_SECRET=a_separate_random_cron_secret
OPENX_API_TOKEN=a_separate_random_api_and_mcp_token
```

Do not prefix secret variables with `NEXT_PUBLIC_`.

## 4. Database

Create a D1 database and bind it as `DB`. Apply the migrations in `drizzle/` using your hosting workflow. With Wrangler:

```bash
npx wrangler d1 migrations apply YOUR_DATABASE --local
npx wrangler d1 migrations apply YOUR_DATABASE --remote
```

Deployment identities are deliberately excluded from Git. For ChatGPT Sites, copy `.openai/hosting.example.json` to `.openai/hosting.json` and let Sites populate the project identifier. For Cloudflare, copy `wrangler.example.jsonc` to `wrangler.jsonc`, insert your D1 database ID and keep that instance-specific file untracked.

### Cloudflare deployment

```bash
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler d1 create openx-growth
# Put the returned database_id in wrangler.jsonc
npm run db:migrate:remote
npm run build
npm run deploy:cloudflare
```

Set production secrets with `wrangler secret put NAME`; do not place them in `wrangler.jsonc`.

## 5. Run locally

```bash
npm run dev
```

Open the local URL, enter `APP_ACCESS_TOKEN`, then use Settings → Continue with X.

## 6. Scheduler

Call the protected scheduler every five minutes:

```bash
curl -X POST "$OPENX_BASE_URL/api/cron/publish" \
  -H "Authorization: Bearer $CRON_SECRET"
```

The included `.github/workflows/scheduler.yml` can do this. Add these repository secrets:

- `OPENX_BASE_URL`
- `OPENX_CRON_SECRET`

Publishing is idempotent. For threads, every successfully published part is recorded before the next request, so retries do not duplicate completed parts.

## AI features and X approval

AI generation is **off by default** and treated as a separate, opt-in use case. Confirm that your declared X use case, the current developer agreement and any approval applicable to your account permit it before setting either flag:

```dotenv
AI_API_KEY=your_provider_key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-5-mini
X_AI_CONTENT_APPROVED=false
X_AI_REPLIES_APPROVED=false
ENABLE_EVERGREEN=false
```

Only change a flag to `true` after completing that policy review and, where X requires it, receiving approval for the modified use case. OpenX still labels generated suggestions, requires review, blocks autonomous replies and never sends DMs. X Content is never used to train or fine-tune a model.

Evergreen recycling is also off by default. Enable `ENABLE_EVERGREEN` only if repeated scheduled publishing is permitted for your disclosed use case, and avoid identical or engagement-bait content.

## API usage and costs

X API access is pay-per-use. OpenX caches intelligence syncs and enforces daily budgets:

```dotenv
SYNC_TTL_SECONDS=900
MAX_DAILY_X_READS=500
MAX_DAILY_X_WRITES=50
```

Tune these limits for your plan. A manual forced sync bypasses cache but still counts against the local budget.

## REST API

Set `OPENX_API_TOKEN` and send:

```http
Authorization: Bearer YOUR_OPENX_API_TOKEN
```

Main endpoints:

- `GET /api/posts`
- `POST /api/posts`
- `PATCH|DELETE /api/posts/:id`
- `POST /api/posts/:id/publish`
- `GET /api/x/sync`
- `GET /api/analytics`
- `GET /api/data/export`
- `POST /api/data/import`
- `POST /api/feedback`

Browser sessions use CSRF protection instead of the API token.

## MCP server

The MCP server exposes content, scheduling, sync and analytics tools:

```bash
OPENX_BASE_URL=https://YOUR_DEPLOYMENT_HOST \
OPENX_API_TOKEN=your_api_token \
npm run mcp
```

Example client configuration:

```json
{
  "mcpServers": {
    "openx-growth": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/OpenX-Growth",
      "env": {
        "OPENX_BASE_URL": "https://YOUR_DEPLOYMENT_HOST",
        "OPENX_API_TOKEN": "YOUR_OPENX_API_TOKEN"
      }
    }
  }
}
```

MCP tools can create drafts and scheduled content, but the server intentionally does not expose direct reply automation.

## Development checks

```bash
npm run lint
npm run typecheck
npm test
npm run privacy:audit
# or run every release gate:
npm run release:check
```

Pull requests must pass build, lint, unit/integration tests and secret scanning. The privacy audit checks tracked files for common credentials, personal email addresses, deployment identities and generated instance hostnames. CI additionally scans full Git history with Gitleaks.

## Privacy and data deletion

- No analytics or telemetry are sent to the maintainers.
- X posts, drafts, analytics and encrypted tokens stay in your D1 database.
- Provider prompts are sent only when you explicitly invoke an enabled AI action.
- Settings → Disconnect X deletes the stored X token.
- Cached feed content expires automatically and is deleted immediately on disconnect.
- Settings → Export downloads portable JSON without credentials.
- Settings → Delete all local data erases drafts, schedules, metrics, feedback, caches, counters and OAuth tokens.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Policy notice

You are responsible for your X developer account, API costs, content and compliance. Review the [X Developer Policy](https://docs.x.com/developer-terms/policy), [Developer Guidelines](https://docs.x.com/developer-guidelines), automation rules and current API documentation before deployment. Technical safeguards in this repository are not legal certification or approval by X.

## Important operational boundaries

- The instance fails closed when `APP_ACCESS_TOKEN` is missing.
- Reply suggestions never publish without a user click. The MCP server intentionally exposes no reply tool.
- The scheduler claims a record atomically before publishing so two workers cannot intentionally process the same due item.
- X does not expose a general idempotency key for Post creation. A crash after X accepts a Post but before the local receipt is stored can still require manual reconciliation.
- GitHub Actions schedules are best effort and can run late. Use a platform cron service when exact timing matters.
- AI and evergreen behavior remain disabled until the operator explicitly enables the relevant policy gates.

Additional release material: [Compliance](docs/COMPLIANCE.md), [Threat model](docs/THREAT_MODEL.md), [Deployment](docs/DEPLOYMENT.md) and [Roadmap](docs/ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports should follow [SECURITY.md](SECURITY.md), not public issues.

## License

OpenX Growth is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you modify it and make the modified software available over a network, you must offer the corresponding source code as required by the license.
