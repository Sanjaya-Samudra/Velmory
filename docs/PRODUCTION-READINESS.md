# Production readiness

Last reviewed: 17 October 2026.

Velmory's repository is prepared for production deployment. The remaining work is environment activation: creating provider projects, supplying public configuration and server secrets, and recording live-provider evidence.

## Enforced in the repository

- Backend types, database and Edge-handler behavior, encryption, migration, backup-format and repository tests.
- Production build, initial-entry size budget, absence of public source maps, required deployment files and user-approved service-worker activation.
- Browser journeys for encrypted persistence, book spreads, sealed pages, audio, letters, collection bounds, settings, responsive layouts and serious accessibility violations.
- Cold offline application-shell launch.
- Global runtime recovery UI and sanitized fixed-code operational failure reporting. No exception text or private content is sent.
- HTTPS hardening headers, immutable fingerprinted assets, no-cache application shell, SPA routing and PWA update control.
- Release validation for public HTTPS URLs, Supabase Auth health, deployed security headers, PWA assets, email readiness, hosted integration evidence and backup-restoration evidence.

## External release evidence

The operator must complete the steps in [LAUNCH.md](LAUNCH.md). A release is blocked until real email confirmation/reset, OAuth, two-account access isolation, Edge Functions, scheduled delivery, account deletion, backup restoration and rollback are verified. Run `npm run check:release` only after those checks pass.

An independent security assessment is still required before describing Velmory as independently audited. Free hosting and email plans cannot guarantee permanent retention or exact delivery times; encrypted operator backups remain part of normal operation.
