# Velmory — local handoff

The working project is at `E:\Sanjaya\MyProjects\Velmory\Project`.

1. Open that folder and double-click **START-VELMORY.cmd**.
2. Keep its terminal open. Visit **http://127.0.0.1:5173/**.
3. Choose **Begin your story → Open a private vault on this device**.
4. Set a vault passphrase, save the recovery key, and create your diary.

The interface includes the supplied candlelit artwork, animated homepage, public pages, bookshelf, encrypted diary editor, search/timeline, local letters, profile and export controls. Private device mode does not require a cloud account.

## Verification — 7 October 2026

- Production TypeScript/Vite build passed.
- Six Vitest tests passed: vault recovery and ciphertext integrity, recipient encryption, PostgreSQL ownership/revision policies, scheduled-letter access and administrator MFA authorization.
- Two Chrome browser journeys passed: encrypted diary creation, writing, refresh/unlock, sign-out/reopen; public routes, 360/390/768/1024/1440px widths, and no serious/critical automated WCAG A/AA homepage findings.
- Desktop/mobile screenshots were visually inspected.
- Windows test-server teardown encountered a process-cleanup error after the browser tests passed; no application assertion failed.

## Release status

This is the first working local build. Hosted login, cross-device synchronization and email require Supabase/Brevo setup and live verification. The README documents remaining implementation: private media upload infrastructure, two-page editing, letter attachments, complete content/collection administration and cold offline loading. Backup restoration and public deployment remain unverified. The complete public-release plan is not yet finished.

The implementation plan is also saved in `E:\Sanjaya\MyProjects\Velmory\Velmory_Implementation_Plan.pdf`.
