# Operations and privacy

The complete current deployment, backup, restore, quota, maintenance and incident procedures are in [BACKEND.md](BACKEND.md). Use that runbook for every hosted operation.

## Encryption boundaries

The device creates a random 256-bit vault key. Argon2id derives the passphrase wrapping key using libsodium interactive parameters. An independent random recovery key wraps the same vault key. XChaCha20-Poly1305 authenticates encrypted documents against owner/document identifiers, with random nonces. Rewrapping changes the passphrase/recovery envelope without changing existing content or recipient identity.

Private diary content, titles, tags, thumbnails and media are encrypted before upload. Account identity, service status, quotas, revisions, contact relationships, ciphertext lengths and delivery scheduling remain service-readable. Keys and unlocked content stay in memory. Browser records, upload caches and portable archives contain ciphertext, never plaintext private media. Search remains local to the unlocked client.

Each shared attachment uses its own random key. The immutable letter payload includes those keys and is encrypted under a separate letter key, sealed to the recipient's X25519 public key. Server checks control access to its delivery envelope and stored attachments. The sender keeps their encrypted original. The service cannot recall a copy already downloaded by a recipient.

## Threat model and limits

Encryption does not protect an already compromised device or malicious delivered application update. Server-enforced opening times are not a cryptographic promise that a malicious server could never release an envelope early. Keep application delivery, dependencies and administrator access secure. This implementation has automated tests but no independent security audit.

An account password reset does not unlock a vault. Vault recovery requires its vault passphrase or recovery key. Rewrapping does not revoke old wraps present in an already exported backup. Full vault master-key rotation requires re-encrypting content and migrating recipient grants; the current API deliberately keeps that identity immutable.

Logout locks the vault and retains pending ciphertext rather than silently discarding offline edits. Device caches can be cleared explicitly after exporting a backup. Account deletion disables service access immediately and asynchronously removes object storage and active database records. Provider backups retain data until their configured retention expires.

## Logging and administration

Never log private content, passwords, bearer tokens, key envelopes, recovery keys or raw provider request bodies. Worker failures use fixed error codes. Administrator APIs require an assigned role and an AAL2 session; they expose account/service metadata and public content, not vault documents, letter payloads or keys. There is no impersonation/unlock API.

## Public release gate

Run the automated suite, the opt-in disposable-project integration test and all manual provider checks listed in BACKEND.md. Demonstrate real SMTP confirmation/reset, OAuth, MFA, interrupted uploads, conflict reconciliation, scheduled delivery, account deletion, managed backup restoration and deployment rollback. Record test dates and remaining issues. Free-tier hosting is not a lifetime preservation or exact-time email guarantee.
