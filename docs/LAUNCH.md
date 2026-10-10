# Velmory: free-tier launch checklist

This repository is ready to connect to new provider accounts. No Supabase, Brevo, Google OAuth, or Cloudflare credentials have been configured here. Do not invite users or rely on hosted preservation until the checks below are recorded as passing.

## Accounts and credentials

1. Create a Supabase Free project, a Brevo Free account, and a Cloudflare Pages project under accounts you control. Google sign-in also needs OAuth credentials from a Google Cloud project. Use the provider dashboards; do not put secret keys in chat, source code, or a `VITE_` variable.
2. Copy `.env.example` to ignored `.env.local`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using Supabase's public project values. Keep `VITE_EMAIL_AUTH_READY=false` until real delivery works.
3. Set up Supabase using the ordered steps in [BACKEND.md](BACKEND.md): all nine migrations, five Edge Functions, private Storage policies, scheduler, Google OAuth, TOTP, and service secrets. Test against an empty disposable project before using the production project.
4. Configure Brevo custom SMTP in Supabase Auth. Check actual confirmation and reset mail to at least two external addresses. The built-in Supabase SMTP is limited to team addresses and is not suitable for public signup.
5. Confirm the sender address or domain required by the mail provider. If domain authentication is required, decide on a domain before opening email signup. Do not purchase one automatically.
6. Deploy the frontend to Cloudflare Pages with build command `npm run build`, output directory `dist`, and the same public environment variables. Configure production and localhost redirect URLs in Supabase Auth. Cloudflare's `_redirects` and `_headers` files are included in `dist`.

## Verify before enabling signup

- Run `npm ci`, `npm run verify`, `npm run test:e2e`, and `npm run test:offline`.
- In a disposable Supabase project, set the variables described in [BACKEND.md](BACKEND.md) and run `npm run test:live`. The test refuses a project with existing users.
- Manually verify Google login, email confirmation/reset, vault recovery on a second device, conflicting edits, resumed media uploads, recipient acceptance, scheduled letter release, encrypted attachment download, admin MFA, quota denial, account deletion, and cross-account denial through direct APIs.
- Run an encrypted database and Storage backup, restore into an isolated project, unlock a test diary and media item, and record the result.
- Rehearse a Cloudflare rollback. Check real production logs for private text, access tokens, recovery keys, and key envelopes.
- Only after mail checks pass, enable `service_settings.email_signup_enabled` through trusted SQL, set `VITE_EMAIL_AUTH_READY=true`, rebuild, and redeploy.

## Free-plan boundaries

Keep the controlled beta small and monitor database, object storage, email attempts, and inactive-project pauses. Provider limits can change; check the current plan pages before inviting users. Keep independent encrypted backups because the free hosted database does not provide downloadable managed backups. A scheduled letter can become overdue during a provider outage and should be released by the recovery job when service resumes.

References: [Supabase free plan and production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/).
