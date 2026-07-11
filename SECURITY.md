# Security policy

## Supported versions

OpenX Growth is early alpha. Security fixes are applied to the latest commit on `main`.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities or leaked credentials. Use GitHub's **Report a vulnerability** private security-advisory flow for this repository. Include impact, affected route or commit, reproduction steps and a minimal proof of concept.

If credentials may have been exposed, revoke them immediately at the provider before reporting:

- regenerate X application keys and revoke user authorization;
- rotate `SESSION_SECRET`, `APP_ACCESS_TOKEN`, `CRON_SECRET` and `OPENX_API_TOKEN`;
- rotate `AI_API_KEY`;
- inspect repository and deployment logs;
- clear the `secure_store` table in D1.

## Security model

- This project is intended as a single-owner, self-hosted instance.
- Production deployments should always set `APP_ACCESS_TOKEN` or sit behind an equivalent identity-aware access proxy.
- The application fails closed when `APP_ACCESS_TOKEN` is absent; failed login attempts are rate-limited using an encrypted D1 record keyed by a hash of the request source.
- OAuth tokens are encrypted with AES-GCM using a key derived from `SESSION_SECRET` before D1 storage.
- Browser write requests require same-origin CSRF validation.
- API and MCP writes require `OPENX_API_TOKEN`.
- Scheduler requests require `CRON_SECRET`.
- AI provider keys exist only in server-side environment bindings.
- The Content Security Policy blocks framing and restricts browser connections to the same origin.
- X write actions enforce local daily budgets and human review.

## Known boundaries

- The application cannot protect a compromised host, malicious dependency, browser extension or owner device.
- D1 encryption protects token values at the application layer; metadata such as update timestamps remains visible.
- Self-hosters are responsible for access logs, backups, D1 retention, provider policies and infrastructure patching.
- Automated security checks reduce risk but do not prove compliance.
- Exact-once X publishing cannot be guaranteed if a process dies after X accepts a Post but before the local receipt is persisted. Inspect failed records before retrying.
- The built-in access gate is defense in depth, not a replacement for deployment-platform WAF, rate limiting and identity-aware access controls.

## Deployment checklist

- [ ] All values in `.env.example` marked as secrets are independently generated.
- [ ] `.env`, Wrangler state and local databases are absent from Git history.
- [ ] `APP_ACCESS_TOKEN` is configured.
- [ ] X callback URL exactly matches the production origin.
- [ ] D1 migrations are applied.
- [ ] Cron and API tokens are different.
- [ ] AI flags remain `false` unless X approval has been obtained.
- [ ] Branch protection and required CI checks are enabled.
- [ ] Dependency alerts and secret scanning are enabled.
