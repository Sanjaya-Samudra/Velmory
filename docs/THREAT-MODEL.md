# Browser vault threat model

Velmory encrypts diary records and media in the browser before cloud synchronization. The vault master key is generated locally, wrapped by an Argon2id-derived passphrase key and independently by the recovery key, and kept in memory while unlocked.

## Protected against

- Direct reading of database rows or private Storage objects without the vault key.
- Cross-account API access when the supplied RLS and Edge Function checks are deployed correctly.
- Ciphertext modification through authenticated encryption and record-specific context.
- An account-password reset being mistaken for vault recovery.

## Not protected against

- Malware, browser extensions, screen capture, or someone controlling an unlocked device.
- XSS or a malicious application update executing in Velmory's origin while unlocked.
- A weak or reused vault passphrase guessed offline from a stolen envelope.
- A recipient retaining an opened future letter.
- The service releasing an encrypted letter envelope early. Scheduling is server-enforced, not a cryptographic time lock.
- Browser eviction, device loss, provider outage, or free-tier pausing. Users need a separate encrypted archive and recovery key.

## Engineering controls

- Keep private content out of logs, analytics, URLs, notifications, and plaintext caches.
- Treat IndexedDB and network responses as untrusted input.
- Keep third-party scripts off the authenticated origin and preserve a restrictive CSP.
- Review dependency and lockfile changes, especially cryptography, rich text, PDF, and service-worker code.
- Clear key buffers on lock/logout on a best-effort basis; JavaScript runtimes can retain copies.
- Version encryption envelopes and migrations. Never silently change KDF parameters or ciphertext context.
- Test wrong keys, modified ciphertext, cross-account denial, recovery on another device, and deletion on the hosted environment.
