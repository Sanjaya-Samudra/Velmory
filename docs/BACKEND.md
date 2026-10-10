# Backend delivery and operation

The frontend's visual layout is unchanged. Backend work lives in additive migrations `001` through `009`, five Edge Functions, the client service adapters, and executable tests. Existing single-page editing and text-only letter controls remain compatible. The new attachment and collection APIs are ready for the later frontend work; those controls have not been added to the UI.

## What is implemented

- Server-owned account status, configurable beta capacity and quotas, verified-email configuration, email signup readiness gate, Google OAuth configuration path, MFA authorization for every admin operation, account email synchronization, and durable account deletion.
- Versioned vault envelopes, passphrase/recovery rewrapping without changing the vault master key, immutable recipient public identity, owner-only encrypted documents, revision checks, idempotent retries, and monotonic per-account synchronization cursors. The client cache uses compound account/document keys and migrates the original database without discarding memories.
- Private media reservations with combined document/letter/media quotas, resumable 512 KiB encrypted chunks, immutable object paths, per-chunk and complete-object SHA-256 verification, and authenticated downloads. An encrypted object is limited to 8 MiB. Abandoned uploads expire after 24 hours. Downloads do not return reusable signed URLs.
- Accepted-contact resolution, invitation limits including unsuccessful lookups, immutable sealed letters with separately encrypted attachments, timezone validation, cancellation, and server-side release checks. The sender's original remains in their own vault. Recipient copies already downloaded cannot be recalled.
- Independent letter release and in-app notifications, read receipts for notification UI, generic email jobs, bounded exponential retries, attempt leases, stale-worker rejection, daily email attempt budgets, and operational health queries.
- Admin account/quota operations, draft/preview/publish/rollback for announcements, pages, cover collections and sticker packs, approved raster artwork uploads, private drafts, audit records, health and usage reporting. Structured content never accepts script fields or executable HTML renderers.
- Encrypted user archives with media; service-side account export; encrypted operator backups of the database and both storage buckets; backup authentication and isolated restore tooling.

## Local verification versus hosted verification

`npm run verify` type-checks the Edge Functions, runs the test suite, and builds the application. PostgreSQL tests execute every migration in PGlite, with Supabase auth identities and Storage catalog tables represented by fixtures. They exercise real PostgreSQL grants, RLS, triggers, constraints and functions. HTTP handler tests exercise the actual Supabase JS client against controlled HTTP responses, including storage failures and provider errors. A native Deno check was attempted but blocked by Windows sandbox path resolution in its dependency cache; the TypeScript backend check passed. These are not substitutes for testing the actual Auth, Storage, PostgREST and Edge runtime together.

Docker was installed but its daemon was unavailable during implementation. No Supabase project credentials or Brevo credentials were supplied. The code is not deployed, real SMTP/Google sign-in is not verified, and an actual managed-Supabase restore has not been performed. Do not call the service production-ready until the hosted checklist below passes.

## Deploy to your own free-tier project

1. Create a Supabase project. Install the official Supabase CLI. Keep its access token and the database password in operator environment variables, never frontend configuration.
2. Link this repository to the intended project and apply **all migrations in order** with `supabase db push`. If `001` was previously applied manually, record that migration as applied before using the CLI. Never re-run `001` against an existing populated database.
3. Use the dashboard to enable confirmed email, minimum password length 12, approved site/redirect URLs, Google OAuth credentials, and TOTP MFA. Local settings are in `supabase/config.toml`; a remote project's Auth settings must also be configured in its dashboard. Configure Brevo custom SMTP. CAPTCHA/rate limits should be enabled according to actual beta traffic.
4. Copy `.env.example` to `.env.local` and set only the public project URL and public anonymous/publishable key. Copy `supabase/functions/.env.example` to a private ignored env file and populate server secrets. Hosted Supabase supplies its built-in URL and keys to Edge Functions.
5. Deploy `media`, `artwork`, `account-delete`, `letter-dispatch` and `maintenance`. Each function has JWT-gateway verification disabled deliberately: user endpoints verify with `auth.getUser()`, artwork uses RLS/publication checks, and workers verify the scheduler bearer secret. Do not remove those checks. The import map pins the server SDK to the version used in tests.
6. Store `project_url` and `scheduler_secret` in Supabase Vault and run `supabase/schedule.sql`. It installs minute-by-minute releases and five-minute maintenance. Keep the scheduler secret at least 32 random bytes. Do not use the public project key as that secret.
7. Before enabling email signup, test provider delivery and reset/confirmation links with controlled accounts. In the trusted SQL console set `public.service_settings.email_signup_enabled=true` for `singleton=true`, then set `VITE_EMAIL_AUTH_READY=true` and rebuild. Leaving the server flag false prevents bypassing the frontend gate through direct signup API calls. Google accounts remain possible once OAuth is configured.
8. Bootstrap your own administrator role through trusted SQL: insert the intended user UUID and role `admin` into `public.user_roles`. Enroll TOTP and verify a session before opening admin APIs. Ordinary accounts cannot assign roles.

No domain or paid subscription is purchased by these scripts. Free email/storage quotas are operational limits, not archival guarantees. The default email budget is 280 attempts per UTC day, leaving headroom under the planned 300/day provider tier for authentication mail. Actual SMTP and other applications can consume that headroom; monitor the provider dashboard as well.

## APIs for the later frontend work

`src/core/service.ts` and `src/core/media.ts` are typed adapters. They do not alter page layouts.

- `fetch_changes(cursor, limit)`: paged encrypted records and tombstones, monotonic cursor, `has_more`. Keep a pending local version when a remote record changes; explicitly reconcile both versions.
- `save_document(id, expected_revision, envelope, deleted)`: owner-bound CAS save; identical retries return the existing revision. A revision conflict must never cause silent overwrite.
- `rewrap_vault(expected_revision, envelope)`: new passphrase/recovery wraps of the **same** master key. The client must retain and confirm the replacement recovery key. Rewrapping does not revoke old offline snapshots already held with an old key.
- `resolve_recipient(id)`: eligible accepted contact's public key. `prepareDelivery` creates separate random attachment keys and an immutable retry request encrypted in the sender's local vault. `submitDelivery` uploads encrypted attachments and calls `seal_letter_with_media`. `receiveDelivery` and `readLetterAttachment` authenticate and decrypt on the client.
- `reserve_media(id, bytes, sha256, purpose)`, `storage_usage()`: quota-controlled reservations and accurate service usage. Purpose is `diary` or `letter`; a diary blob cannot become a letter attachment.
- Media HTTP operations: `POST ?action=reserve` JSON; `GET ?action=status&id=UUID`; `PUT ?action=chunk&id=UUID&part=N` ciphertext; `POST ?action=commit&id=UUID`; `GET ?action=download&id=UUID`; `DELETE ?id=UUID`. Use the caller's bearer token and public API key. A chunk conflict requires a new media identifier; do not overwrite committed media.
- `open_letter(id)`: server checks recipient, active sender, cancellation, and UTC time on every request. Returns the encrypted snapshot and wrapped key only when eligible. `cancel_letter(id)` removes access; attachment download checks the same grant.
- `mark_notification_read(id)`, `account_export(cursor)`, `admin_health()`, `admin_settings(accounts, quota, daily_emails)`.
- Content RPCs: `admin_save_content`, `admin_publish_content`, `admin_unpublish_content`. Publish an earlier revision to roll back. Public clients read only published rows through RLS. `artwork?id=UUID` accepts administrator `PUT` of PNG/JPEG/WebP up to 5 MiB and public `GET` only after a published document references it; verified admins may preview drafts.

Content bodies are plain structured data. Announcements use `{text}` and optional `title`; pages use `{title, description, sections:[{heading,text,asset_id?}]}`; covers/stickers use `{title, items:[{name,asset_id}]}`. Render strings as text, never `innerHTML`. Raster uploads are checked by file signatures and served with `nosniff` and a restrictive CSP. Keep all published/rollback assets immutable.

## Account deletion and cleanup

`POST account-delete` returns **202 pending**, not a false promise of immediate deletion. The database disables private operations immediately, cancels affected deliveries, and records a durable request. Maintenance waits 15 minutes for in-flight transfers, removes storage objects through the Storage API, then deletes the Auth user so database records cascade. Failures retain the request for retry. Deleting database Storage metadata directly is forbidden because it leaves actual files behind. The worker also removes expired reservations and orphan account namespaces.

Watch `admin_health()` for pending deletions, failed/exhausted jobs, near-quota users and health timestamps. A worker timestamp older than 15 minutes needs investigation even if its last status was `ok`. A generic email already handed to the provider cannot be recalled by cancellation; cancellation still prevents future service access to the letter.

## Daily backup and tested restoration procedure

Use a protected operator machine with Node 22+, PostgreSQL `pg_dump`/`pg_restore`, and the required PG connection variables. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `VELMORY_BACKUP_KEY` (a separately stored 64-character hex key). Do not write these into source control or shell transcripts.

1. In trusted SQL set `service_settings.maintenance=true`. This blocks ordinary private writes, signup and administrator changes; workers pause. Wait at least 15 minutes for in-flight uploads and provider requests. Keep maintenance active for the entire snapshot.
2. Set `VELMORY_MAINTENANCE_CONFIRMED=yes`. Run `node scripts/backup.mjs <new-private-directory>`. It encrypts the PostgreSQL dump and every object from both buckets with AES-256-GCM. The authenticated manifest is written **last**; its absence means the backup is incomplete.
3. Run `node scripts/restore.mjs <directory> --verify-only`. It authenticates the database and every storage object without modifying a service. Clear maintenance after the backup completes or fails; never leave it enabled accidentally.
4. For a full restore drill, prepare a separate disposable Supabase project with empty users and storage, compatible base schemas and the same two bucket definitions. Point both `PG*` and Supabase credentials to that **same** target. Set `VELMORY_RESTORE_CONFIRM=EMPTY_DISPOSABLE_TARGET`; run `node scripts/restore.mjs <directory>`. The script refuses a target with existing users or files. It cleans/restores only the public/auth schemas captured in the backup and uploads authenticated object copies.
5. Reconfigure project-specific OAuth/SMTP/Edge secrets and cron Vault values; these are intentionally outside the public/auth dump. The source snapshot preserves maintenance mode; leave it enabled until the restored target's checks pass, then clear it in trusted SQL. Verify a test recovery key decrypts a diary and photo, confirm cross-account denial, run a scheduled test letter, and record the result/date.

The automated suite restores a physical local PostgreSQL snapshot and rechecks RLS; it also tests backup encryption/tamper rejection. Actual `pg_dump`/`pg_restore` against managed Supabase is a separate required operator drill, not something claimed as completed here. Encrypt the backup disk too: authentication metadata is sensitive even though private memories were already encrypted. Retain copies on a separate device and test monthly.

## Opt-in live integration suite

After migrating and deploying into an **empty disposable Supabase project**, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `VELMORY_LIVE_TEST_CONFIRM=DISPOSABLE_PROJECT`. Run `npm run test:live`. It temporarily enables email-account creation, creates two confirmed test accounts, exercises real authentication, document isolation, private chunk storage, early/due/cancelled letter access, and removes its test objects/accounts afterward. It refuses a project with existing users. It does not send email or verify Google OAuth; those remain manual provider checks. This suite is not run by `npm test` and was not executed without credentials.

## Hosted release checklist

- Apply migrations through the real Supabase CLI; verify function import maps and private bucket policies.
- Test Google login, email signup/confirmation/reset, account password reset versus vault recovery, and administrator MFA.
- Test two-device edits, expired sessions, duplicate retries, quota exhaustion, media upload interruption, archive export/import and same-time conflicting changes.
- Test early letter access through RPC **and direct Storage**, released attachments, cancellation during download, provider failures, duplicate worker calls, sender suspension, and durable deletion.
- Verify public draft isolation and publishing/rollback. Inspect logs for tokens, keys, content and raw provider errors; none should be emitted by these handlers.
- Complete the managed database/media restore drill and Cloudflare rollback rehearsal before accepting irreplaceable memories.

Primary references: [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Storage ownership and user deletion](https://supabase.com/docs/guides/auth/managing-user-data), [Storage object deletion](https://supabase.com/docs/guides/storage/management/delete-objects). Velmory uses its own authenticated chunk protocol rather than exposing Storage upload credentials to clients.
