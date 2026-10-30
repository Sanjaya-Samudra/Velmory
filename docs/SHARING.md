# Sharing an existing diary

Open a private diary and choose **Share this diary**. This creates a shared working edition with the existing pages. Continue writing in that edition from Shared diaries. The private original is retained as a snapshot, not a two-way synchronized duplicate.

Invite accepted contacts from Shared diaries, selecting **Can view** or **Can edit**. The owner can use **Manage access** to change either permission, revoke a pending invitation, or remove an active person. Database functions enforce permissions independently of the interface. Removed users cannot fetch or write future data; copies already downloaded cannot be recalled. The shared content key is not rotated on removal.

Apply `supabase/migrations/013_shared_permissions.sql` through `npx supabase db push` before deploying this frontend. It requires migration 012. It also fixes the shared-page change cursor so edits to existing pages are discoverable.

Current conversion limitations: diaries containing chunked private audio or password-sealed pages are rejected before any shared diary is created. No private audio storage access is implicitly granted. Text, drawings, embedded photographs, and stickers are copied with their page content. The shared title is server-readable. Shared pages have an 8 MB encrypted envelope limit.

Verification: 47 automated tests passed, including database tests for viewer write denial, owner-only role changes, foreign-account denial, revocation, and updated-page cursors. Hosted multi-account browser verification still requires configured Supabase accounts.
