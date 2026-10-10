import {it,expect} from 'vitest';
import {encryptBuffer,decryptBuffer,backupKey} from '../scripts/backup-format.mjs';
it('encrypts operator backups and rejects a wrong key or changed backup',()=>{const key=backupKey('a'.repeat(64)),data=Buffer.from('Private account metadata and encrypted media');const encrypted=encryptBuffer(data,key);expect(encrypted.includes(data)).toBe(false);expect(decryptBuffer(encrypted,key)).toEqual(data);expect(()=>decryptBuffer(encrypted,backupKey('b'.repeat(64)))).toThrow();encrypted[25]^=1;expect(()=>decryptBuffer(encrypted,key)).toThrow()});
