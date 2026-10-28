import {describe,it,expect} from 'vitest';
import {createVault} from '../src/core/crypto';
import {
  unwrapSharedKey,
  getSharedKey,
  clearSharedKeyCache,
  encryptSharedPage,
  decryptSharedPage,
} from '../src/core/sharedDiary';
import {newPage, type DiaryPage} from '../src/core/types';

describe('shared diary crypto', () => {
  it('wraps and unwraps the shared content key with vault keys for multiple members', async () => {
    const s = await import('libsodium-wrappers-sumo').then(async m => {
      await m.default.ready;
      return m.default;
    });

    // Alice (owner) and Bob (collaborator) each have private vaults
    const alice = await createVault('passphrase-for-alice-vault', 'alice-id');
    const bob = await createVault('passphrase-for-bob-collaborator', 'bob-id');

    // Generate a shared content key
    const rawContentKey = s.randombytes_buf(32);

    // Wrap for Alice
    const wrappedForAlice = s.to_base64(
      s.crypto_box_seal(rawContentKey, s.from_base64(alice.envelope.publicKey))
    );

    // Wrap for Bob
    const wrappedForBob = s.to_base64(
      s.crypto_box_seal(rawContentKey, s.from_base64(bob.envelope.publicKey))
    );

    // Both Alice and Bob can unwrap the identical content key
    const aliceUnwrapped = await unwrapSharedKey(wrappedForAlice, alice.key);
    const bobUnwrapped = await unwrapSharedKey(wrappedForBob, bob.key);

    expect(aliceUnwrapped).toEqual(rawContentKey);
    expect(bobUnwrapped).toEqual(rawContentKey);

    // Bob cannot decrypt Alice's wrapped key
    await expect(unwrapSharedKey(wrappedForAlice, bob.key)).rejects.toThrow();
  });

  it('encrypts and decrypts shared pages between collaborators', async () => {
    const s = await import('libsodium-wrappers-sumo').then(async m => {
      await m.default.ready;
      return m.default;
    });

    const sharedKey = s.randombytes_buf(32);
    const diaryId = 'diary-test-123';

    const page: DiaryPage = {
      ...newPage(),
      title: 'Our Trip to Paris',
      place: 'Eiffel Tower',
      people: 'Alice & Bob',
      objects: [
        {
          id: 'obj-1',
          kind: 'text',
          x: 10,
          y: 20,
          width: 200,
          height: 100,
          rotation: 0,
          content: 'A day we will never forget!',
        },
      ],
    };

    // Alice encrypts the shared page
    const envelope = await encryptSharedPage(page, sharedKey, diaryId);
    expect(JSON.stringify(envelope)).not.toContain('Our Trip to Paris');
    expect(JSON.stringify(envelope)).not.toContain('Eiffel Tower');

    // Bob decrypts the page with the shared content key
    const decrypted = await decryptSharedPage(envelope, sharedKey, diaryId, page.id);
    expect(decrypted.title).toBe('Our Trip to Paris');
    expect(decrypted.place).toBe('Eiffel Tower');
    expect(decrypted.objects[0].content).toBe('A day we will never forget!');

    // Tampered page or wrong context fails decryption
    await expect(
      decryptSharedPage(envelope, sharedKey, 'different-diary-id', page.id)
    ).rejects.toThrow();
  });

  it('clears shared key cache properly', async () => {
    const s = await import('libsodium-wrappers-sumo').then(async m => {
      await m.default.ready;
      return m.default;
    });

    const user = await createVault('vault-passphrase-testing-cache', 'user-id');
    const rawKey = s.randombytes_buf(32);
    const wrappedKey = s.to_base64(
      s.crypto_box_seal(rawKey, s.from_base64(user.envelope.publicKey))
    );

    const key1 = await getSharedKey('diary-cache-test', wrappedKey, user.key);
    expect(key1).toEqual(rawKey);

    // Call clear
    clearSharedKeyCache();

    // After clearing, unwrap should obtain a fresh valid copy
    const key2 = await getSharedKey('diary-cache-test', wrappedKey, user.key);
    expect(key2).toEqual(rawKey);
  });
});
