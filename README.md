# OpenX Growth

Open-source, self-hosted tools for growing on X without giving a third-party service your account credentials or content history.
<img width="1710" height="984" alt="Screenshot 2026-07-11 alle 22 13 26" src="https://github.com/user-attachments/assets/242b527c-bc74-4468-bb5f-1a3cffe54770" />


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
- Overview **Today's Growth Plan** from already-loaded ideas and reply opportunities, with optional user-initiated AI draft generation.
- Draft, single-post and thread editor.
- Persistent D1 content queue and protected scheduled publisher.
- Idempotent thread publishing with partial-progress recovery.
- Optional evergreen recycling with configurable intervals and a default-off policy gate.
- Post and follower snapshots with explicit `live`/`derived`/`estimate` provenance and timestamps. Date ranges filter the real series; sparse ranges show `Insufficient data`.
- Posting-time recommendations use median engagement rate by UTC hour, require at least eight linked published posts overall and at least two samples for each suggested hour.
- Deterministic, versioned EN/IT ranking uses Unicode topics, freshness, topical affinity, reach, engagement, novelty and bounded 90-day feedback. Results expose material score features and apply author/topic diversity; feedback never triggers an autonomous reply.
- Atomic daily X resource/write-attempt budgets, request events, caching and provider rate-limit metadata.
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
openssl rand -base64 32  # CRON_SECRET (optional until you enable scheduled publishing)
openssl rand -base64 32  # OPENX_API_TOKEN (optional for REST/MCP automation)
openssl rand -base64 32  # APP_ACCESS_TOKEN (required before configuring X)
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
APP_ACCESS_TOKEN=a_distinct_random_access_token
CRON_SECRET=
OPENX_API_TOKEN=
```

`APP_ACCESS_TOKEN` may be empty only while the instance is an unconfigured, write-disabled public demo. As soon as `X_CLIENT_ID` and `SESSION_SECRET` configure the instance, a missing application token fails closed before any application data, OAuth flow, API token or scheduler token is accepted.

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

Open the local URL. The dashboard loads immediately in unconfigured, write-disabled demo mode. Before setting `X_CLIENT_ID` and `SESSION_SECRET`, also set `APP_ACCESS_TOKEN`; restart the dev server, log in, then use **Settings → Continue with X**.

## 6. Scheduler

Call the protected scheduler every five minutes:

```bash
curl -X POST "$OPENX_BASE_URL/api/cron/publish" \
  -H "Authorization: Bearer $CRON_SECRET"
```

The included `.github/workflows/scheduler.yml` can do this. Add these repository secrets:

- `OPENX_BASE_URL`
- `OPENX_CRON_SECRET`

Publishing uses expiring conditional leases. For threads, each confirmed X identifier and its acceptance/confirmation timestamps are stored before the next part starts, so an expired safe lease resumes after the last confirmed part. This is not an exact-once guarantee: if X may have accepted a request before its local receipt exists, the post moves to `needs_review` and is never retried automatically.

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

The Overview plan never calls X or AI while rendering. `Create draft` opens an editable deterministic seed. `Generate with AI` appears only when the provider and content-approval flag are ready, and it sends exactly one request after a user click. Provider output is treated as untrusted: requests, response envelopes, JSON content, post/thread lengths, response size and timeout are validated server-side before a labelled suggestion can enter the Composer. Publishing remains a separate human action behind the existing approval gates.

## API usage and costs

X API access is pay-per-use. OpenX caches intelligence syncs and enforces daily budgets:

```dotenv
SYNC_TTL_SECONDS=900
MAX_DAILY_X_RESOURCES=500
MAX_DAILY_X_WRITES=50
```

Each outbound call increments the request count. Reads reserve their requested worst-case resource count atomically, then reconcile to successfully returned users/posts; failed calls and `429` responses consume zero resources. Every outbound post/reply attempt consumes one write unit regardless of provider status, and a retry is a separate request and write attempt. `MAX_DAILY_X_READS` remains a legacy fallback when the resource variable is unset.

Tune these local limits below your paid plan. A manual forced sync bypasses cache but still counts against the budget. The X provider console spend limit remains the external hard backstop; local counters cannot replace it.

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

`POST /api/posts/:id/publish` accepts an empty body for a normal publish. A `needs_review` record requires an explicit operator reconciliation on the same endpoint: `{ "action":"reconcile", "resolution":"accepted", "xPostIds":[...] }` records the verified complete X thread, while `{ "action":"reconcile", "resolution":"not_accepted" }` confirms that the ambiguous request was not accepted and makes only unconfirmed parts retryable. Reconciliation performs no X request. Schema-v1 exports remain content-portable and omit lease tokens, delivery state, and operational receipts; a `needs_review` status is exported conservatively as `failed`.

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

The hermetic HTTP E2E runner starts isolated local instances, applies migrations to temporary D1 state and injects deterministic X and OpenAI-compatible fixtures. It does not load local environment files or call live X/AI services:

```bash
npm run test:e2e
```

The lower-level `test:e2e:demo`, `test:e2e:misconfigured` and `test:e2e:configured` commands remain available for an already-running isolated test instance. Set `E2E_BASE_URL` to override their default local URL; never point them at production.

## Privacy and data deletion

- No analytics or telemetry are sent to the maintainers.
- X posts, drafts, analytics and encrypted tokens stay in your D1 database.
- Provider prompts are sent only when you explicitly invoke an enabled AI action.
- AI style context is limited to the 12 newest human-written (`generated=false`) post texts plus bounded feedback signals. Context and style samples are marked as untrusted source material in the provider prompt.
- Settings → Disconnect X deletes the stored X token.
- Cached feed content expires automatically and is deleted immediately on disconnect.
- Settings → Export downloads portable JSON without credentials.
- Settings → Delete all local data erases drafts, schedules, metrics, feedback, caches, counters and OAuth tokens.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Policy notice

You are responsible for your X developer account, API costs, content and compliance. Review the [X Developer Policy](https://docs.x.com/developer-terms/policy), [Developer Guidelines](https://docs.x.com/developer-guidelines), automation rules and current API documentation before deployment. Technical safeguards in this repository are not legal certification or approval by X.

## Important operational boundaries

- Public demo mode works without `APP_ACCESS_TOKEN` only while X is unconfigured and every mutation is disabled. Every configured instance requires the token and fails closed without it.
- Reply suggestions never publish without a user click. The MCP server intentionally exposes no reply tool.
- The scheduler claims a record with an expiring lease. Active leases cannot be stolen; expired leases resume only from confirmed receipts.
- X does not expose a general idempotency key for Post creation. A possible acceptance without a local receipt becomes `needs_review` and requires explicit manual reconciliation; OpenX never blindly retries it.
- GitHub Actions schedules are best effort and can run late. Use a platform cron service when exact timing matters.
- AI and evergreen behavior remain disabled until the operator explicitly enables the relevant policy gates.

Additional release material: [Compliance](docs/COMPLIANCE.md), [Threat model](docs/THREAT_MODEL.md), [Deployment](docs/DEPLOYMENT.md) and [Roadmap](docs/ROADMAP.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports should follow [SECURITY.md](SECURITY.md), not public issues.

## License

OpenX Growth is licensed under the [Apache License, Version 2.0](LICENSE). You may use, modify, and distribute it under those terms. See [NOTICE](NOTICE) for attribution requirements.
