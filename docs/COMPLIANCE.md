# Compliance and policy controls

OpenX Growth is software, not a certification service. The operator of each fork is responsible for the current X Developer Agreement, automation rules, privacy law, API costs and content published by that instance.

| Risk | Default control |
| --- | --- |
| Credential disclosure | Secrets are environment-only; OAuth tokens are AES-GCM encrypted; exports omit credentials. |
| Unauthorized access | Production fails closed without `APP_ACCESS_TOKEN`; API, scheduler and MCP use independent tokens. |
| Cross-site writes | Browser mutations require a same-origin double-submit CSRF token and SameSite cookies. |
| Automated replies | No autonomous reply worker or MCP reply tool; every reply requires an explicit user action. |
| AI-generated content | Disabled unless the relevant X policy approval flag is explicitly enabled. |
| Spam and repetition | Evergreen is disabled by default and has a minimum interval. |
| Excess API spend | Sync cache, daily read/write budgets and rate-limit errors. |
| Data retention | Feed data is short-lived cache; disconnect and full deletion endpoints are provided. |
| Hidden data source | UI distinguishes demo, live, generated and persistent records. |

## Pre-deployment checklist

1. Disclose the complete use case in the X Developer Console.
2. Confirm that every requested OAuth scope is necessary.
3. Obtain any approval required for AI-generated posts or replies before enabling those flags.
4. Keep replies human-reviewed; do not enable unsolicited mentions, DMs or engagement manipulation.
5. Publish an operator-specific privacy notice if anyone besides the owner can access the instance.
6. Re-check X policies before every release.

References: [Developer Policy](https://docs.x.com/developer-terms/policy), [Developer Guidelines](https://docs.x.com/developer-guidelines), [OAuth 2.0](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), and [API pricing](https://docs.x.com/x-api/getting-started/pricing).
