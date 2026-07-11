# Contributing

Thanks for helping make OpenX Growth safer and more useful.

## Before opening a pull request

1. Open or reference an issue for substantial behavior changes.
2. Use only official X APIs. Scraping and browser automation will not be accepted.
3. Do not add auto-replies, unsolicited DMs, engagement manipulation or hidden automation.
4. Never include live API keys, tokens, personal exports, account handles or production logs.
5. Add tests for changed behavior.
6. Run:

```bash
npm ci
npm run check
```

## Development

Fork the repository, create a focused branch, and use `.env.example`. Keep AI approval flags false during development unless you are testing an approved X application.

Generated migrations belong in `drizzle/`. Do not rewrite an applied migration; create a new one.

## Pull requests

- Explain the user problem and security/policy impact.
- List new environment variables or migrations.
- Include screenshots for visible UI changes.
- State how the change was tested.
- Keep unrelated formatting changes out of the PR.

By contributing, you agree that your contribution is licensed under AGPL-3.0-only.

## Security issues

Follow [SECURITY.md](SECURITY.md). Never publish exploit details or secrets in a normal issue.
