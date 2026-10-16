# Velmory

A private diary application with a candlelit visual identity, an encrypted local vault, a spatial page editor, and a Supabase deployment foundation.

## Open it now

Double-click `START-VELMORY.cmd` in this directory. Keep the terminal open while using the app. Open http://127.0.0.1:5173/.

Choose **Begin your story → Open a private vault on this device**. Choose a passphrase of at least 12 characters and save the recovery key. Then create a diary and write, draw, or add photos, stickers, and audio.

Device mode is real encrypted local storage, not a fake cloud account. Clearing browser data destroys the local copy. Export an encrypted backup regularly. Local letters cannot send notifications or deliver to another user.

## Commands

Requires Node.js 22.12 or later.

```sh
npm install
npm run dev
npm run build
npm test
npm run test:e2e
```

The browser tests use installed Google Chrome. The source dependencies are locked in `package-lock.json`. On Windows with a trusted local HTTPS inspection certificate, `NODE_OPTIONS=--use-system-ca` lets Node use the operating system trust store; do not disable TLS verification.

## Connect hosted accounts

1. Create a Supabase project under your own account. Apply all migrations in `supabase/migrations` in order; see `docs/BACKEND.md`.
2. Copy `.env.example` to `.env.local`. Fill in your public Supabase URL and anonymous/publishable key. Never place the service-role key in a `VITE_` variable.
3. Configure Google OAuth and approved redirect URLs. Configure Brevo as the custom SMTP provider. Verify confirmation and password recovery using real test accounts.
4. Only after email checks pass, enable `service_settings.email_signup_enabled` through trusted SQL, then set `VITE_EMAIL_AUTH_READY=true`.
5. Deploy `account-delete`, `letter-dispatch`, `maintenance`, `media`, and `artwork` Edge Functions. Set server secrets `BREVO_API_KEY`, `MAIL_FROM`, `APP_URL`, and `SCHEDULER_SECRET` in Supabase.
6. Put `project_url` and `scheduler_secret` into Supabase Vault and apply `supabase/schedule.sql` once. The scheduler authenticates with its own secret, not a public anonymous key.
7. Promote your own account to administrator by inserting its UUID into `public.user_roles` through the trusted SQL console. Use `/app/admin` and enroll an authenticator. Every administrative operation requires AAL2.
8. Deploy `dist/` to Cloudflare Pages with build command `npm run build` and output directory `dist`. Set the public environment variables at build time, then rebuild. Update production redirects and Edge Function `APP_URL`.

No remote account, deployment, domain, provider subscription, or charge was created by this local installation.

## Current implementation boundaries

- Public pages, account forms, encrypted device vault, recovery-key unlocking, diary creation/archive/deletion, password-sealed pages, typed text, drawing, photo/audio insertion, spatial object controls, bookmarks, grouped and paginated memories, full-date search/filtering, chapter timeline, On This Day and Memory Time Machine, self letters, private profile, PDF export and encrypted archive export/import are implemented.
- Backend migrations, private resumable media endpoints, quota enforcement, cursor synchronization, scheduled attachments, durable deletion, structured content administration and encrypted backup tooling are implemented. See `docs/BACKEND.md` for deployment and verification limits. Real Auth/SMTP/Storage/Edge integration still requires live service verification.
- The editor shows a facing page on wide desktops and a single editable page on phones. It supports 48 stickers, typography/ink/alignment controls, rich text, duplication and layering. Curved 3D meshes and independently editing two pages simultaneously are not implemented.
- Diary metadata and pages are independently encrypted and synchronized. Older whole-diary records migrate automatically after unlock, allowing page-level saves and conflicts.
- New audio uses independently keyed authenticated binary pieces without base64 expansion. Device mode permits up to 100 MiB on desktop and 25 MiB on small screens; hosted uploads use the account's live remaining encrypted allowance. Audio stays local if an upload fails and retries on synchronization.
- Letter composition supports up to ten separately encrypted attachments of 4 MiB each, with a retryable local copy when hosted delivery fails. Recipient identity fingerprints are not yet shown in the interface.
- The admin UI handles accounts, quotas, jobs, auditing, structured page/cover/sticker/announcement drafts, artwork uploads, preview, publish, unpublish and rollback. Published page sections and announcements render on the public site. Published cover collections can be chosen during diary creation, and published sticker packs can be inserted into diary pages. The chosen artwork is embedded in the encrypted diary document.
- The production build includes a web manifest and a static app-shell service worker. Cached routes reopen offline after installation, users receive an update prompt for a waiting worker, and private content remains encrypted in IndexedDB. The development server does not register it.
- Private-vault cryptography has automated tests; the application has not had an independent security audit. Do not advertise audited security or guaranteed lifelong preservation.

See `docs/FRONTEND-REDESIGN.md` for the new screens and their controls. See `docs/OPERATIONS.md`, `docs/ASSETS.md`, and the implementation-plan PDF in the parent folder.

Run `npm run verify` for backend type checking, tests and a production build. CI runs browser and offline journeys sequentially. Full backend operations and restore procedures: `docs/BACKEND.md`. Browser protection limits are in `docs/THREAT-MODEL.md`.

## Free-tier launch

See `docs/LAUNCH.md` for provider account setup, the release gate, and hosted verification. `npm run test:offline` checks a cold offline launch of the production build. No provider accounts are configured in this checkout.
