# Velmory verification record

Last updated: 16 October 2026.

## Automated evidence

- `npm run check:backend`: passed.
- `npm test`: 41 tests passed across seven files.
- `npm run build`: passed. Large-chunk warnings remain visible and tracked.
- `npm run check:artifacts`: passed; deployment files, security headers, source-map policy, service-worker activation and the 600 KB initial-entry budget were verified.
- Browser journeys: all eight applicable live journeys passed sequentially.
- `npm run test:offline`: the production shell opened after a cold offline launch.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities at review time.

Run browser and offline suites sequentially because Playwright uses the same `test-results` directory.

## Implemented hardening

- Diary metadata and pages are independently encrypted. Legacy whole-diary records migrate automatically.
- Rapid edits are coalesced before encryption; conflicts now occur per encrypted page record.
- New audio uses authenticated binary chunks without base64 expansion. Hosted size limits use live remaining quota.
- Page and diary deletion queue unreferenced audio for cloud removal.
- Recovery onboarding proves the generated recovery key.
- Settings reports browser persistence plus real local/cloud quotas.
- Page reorder, duplicate, delete, precise controls, notifications, update prompts, CI, and public metadata are implemented.
- Unexpected render failures show a safe recovery screen, hosted client failures use fixed non-private event codes, and page eviction locks the in-memory vault key.

## Evidence required before public launch

- Create Supabase, Brevo, and Cloudflare projects; apply migrations and deploy Edge Functions.
- Run `npm run test:live` against a disposable project.
- Verify signup, reset, Google OAuth, SPF/DKIM/DMARC, bounce handling, reminders, release, cancellation, and email outages.
- Execute hosted database/private Storage backup and restore.
- Test cross-account RLS, two real browsers editing one page, deletion, pause/resume, and rollback.
- Complete manual WCAG 2.2 AA keyboard, screen-reader, zoom, contrast, target-size, and drag-alternative checks.
- Obtain an independent security review before advertising audited security.

Local checks do not prove provider configuration or lifelong availability.
