# Changelog

All notable changes will be documented here.

## [Unreleased]

### Added

- Fork-first X OAuth configuration and encrypted token storage.
- Reply opportunities, content ideas and feedback signals.
- Overview **Today's Growth Plan** from loaded ideas and reply opportunities, with deterministic draft seeding and optional user-initiated AI generation.
- D1-backed drafts, threads, schedules, evergreen recycling and analytics.
- Optional policy-gated AI provider.
- Import/export, REST API and MCP server.
- Light theme, notification center and setup guide.
- CSRF, CSP, access-token gate, API budgets and protected cron publisher.

### Fixed

- Batch analytics snapshot writes within D1's bound-parameter limit.
- Include synchronized X posts in account-level analytics totals.
- Show live follower counts without presenting demo history as real data.
- Keep every setup-wizard step scrollable while its footer remains available.
- Make the documented Node 22.13 test command self-contained; HTTP E2E suites now run explicitly against isolated instances.
