# Privacy

OpenX Growth is self-hosted and has no maintainer-operated backend, tracking pixel, analytics SDK or telemetry endpoint.

## Data processed by an instance

- OAuth access and refresh tokens for the connected X account;
- posts returned by the X home and user timelines;
- drafts, threads, schedules and publishing errors;
- engagement metric snapshots;
- idea and reply relevance feedback;
- local API-usage counters.
- short-lived, encrypted login-attempt counters keyed by a truncated hash of the request source address (the raw address is not stored).

## Where data goes

- X API, when you connect, sync, publish or reply;
- your configured D1 database;
- your configured AI provider, only when you explicitly invoke an enabled AI action;
- your MCP client, when you run the local MCP server.

No data is sent to this repository's maintainers.

## Retention and deletion

- Feed posts are retained only in the short-lived sync cache. Expired cache rows are removed during reads and protected scheduler runs.
- Login-attempt counters use a 15-minute window and expired rows are removed on later login requests; deleting all local data removes them immediately.
- Settings → Disconnect X deletes the encrypted stored OAuth session and all cached feed content.
- Settings → Export creates a portable JSON file without credentials.
- Settings → Delete all local data removes drafts, schedules, metrics, feedback, caches, counters and OAuth tokens.
- Deleting the D1 database removes application records for that instance.
- X and AI providers retain data according to their own terms.

## Self-hoster responsibilities

The person operating an instance determines its privacy notice, contact channel, lawful basis, access control, backups and retention. Customize both this file and the in-app `/privacy` page before serving other people. Do not expose a configured instance publicly without authentication. Do not use other people's X data outside reasonable expectations or X policy.
