# Threat model

The supported deployment is one owner, one fork, one X account and one D1 database. Multi-tenant SaaS operation is outside the current security model.

## Protected assets

- X access and refresh tokens;
- application, scheduler and API bearer tokens;
- AI provider keys;
- cached feed content, drafts, schedules and analytics;
- the ability to publish from the connected X account.

## Trust boundaries

The browser is untrusted for secrets. X, the configured AI provider, deployment host, D1 and the owner's MCP client are external boundaries. No credential is intentionally sent to project maintainers.

## Threats and mitigations

- **Repository leak:** ignored instance files, privacy audit, Gitleaks and placeholders only.
- **Database disclosure:** OAuth tokens are AES-GCM sealed; rotate `SESSION_SECRET` and reconnect X after compromise.
- **CSRF:** SameSite cookies plus a required CSRF header for browser writes.
- **Brute-force access:** failed logins are rate-limited by a hashed source identifier stored encrypted in D1.
- **Duplicate scheduling:** records are conditionally claimed before publishing and thread progress is persisted after each part.
- **Prompt injection:** feed text is untrusted context; generated output never executes and publishing stays gated.
- **Supply chain:** lockfile installs, Dependabot, CI and dependency review.

## Residual risks

A compromised host, owner browser, dependency, deployment account or provider can access data available to that boundary. Exact-once publishing cannot be guaranteed across a crash between remote X acceptance and local receipt storage. Enable platform WAF/rate limiting, audit logs, backups and branch protection.
