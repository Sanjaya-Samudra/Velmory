import {spawn} from 'node:child_process';
import {readFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createClient} from '@supabase/supabase-js';
import {backupKey,decryptBuffer,decryptFile,fileHash,digest} from './backup-format.mjs';
const check=r=>{if(r.error)throw Error('Restore service operation failed');return r.data};
export async function restore(source,verifyOnly){
 const key=backupKey(),root=resolve(source);const manifest=JSON.parse(decryptBuffer(await readFile(join(root,'manifest.enc')),key).toString());
 if(manifest.format!=='velmory-operator-backup'||manifest.version!==1||manifest.database.file!=='database.enc'||!Array.isArray(manifest.objects))throw Error('Invalid manifest');
 if(await fileHash(join(root,'database.enc'))!==manifest.database.sha256)throw Error('Database backup digest mismatch');
 for(const object of manifest.objects){if(!/^object-\d+\.enc$/.test(object.file)||!['velmory-private','velmory-artwork'].includes(object.bucket)||typeof object.path!=='string'||object.path.includes('..'))throw Error('Invalid object descriptor');const bytes=decryptBuffer(await readFile(join(root,object.file)),key);if(bytes.length!==object.bytes||digest(bytes)!==object.sha256)throw Error('Object integrity check failed')}
 const temporary=await mkdtemp(join(tmpdir(),'velmory-restore-')),dump=join(temporary,'database.dump');
 try{
  await decryptFile(join(root,'database.enc'),dump,key);
  if(verifyOnly){console.log(`Backup authentication verified: database and ${manifest.objects.length} objects. No restore performed.`);return}
  if(process.env.VELMORY_RESTORE_CONFIRM!=='EMPTY_DISPOSABLE_TARGET')throw Error('Restore requires explicit EMPTY_DISPOSABLE_TARGET confirmation.');
  const url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!secret)throw Error('Destination service credentials required');
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});const users=check(await admin.auth.admin.listUsers({page:1,perPage:1}));if(users.users.length)throw Error('Refusing to restore over existing users');
  for(const bucket of ['velmory-private','velmory-artwork'])if(check(await admin.storage.from(bucket).list('',{limit:1})).length)throw Error('Refusing to restore over existing storage');
  // PG* must point to the same isolated destination as SUPABASE_URL.
  const child=spawn('pg_restore',['--no-owner','--exit-on-error','--clean','--if-exists','--dbname',process.env.PGDATABASE||'postgres',dump],{stdio:['ignore','ignore','pipe'],windowsHide:true});child.stderr.resume();await new Promise((resolve,reject)=>{child.on('error',()=>reject(Error('pg_restore unavailable')));child.on('exit',code=>code===0?resolve():reject(Error('Database restore failed')))});
  for(const object of manifest.objects){const bytes=decryptBuffer(await readFile(join(root,object.file)),key);check(await admin.storage.from(object.bucket).upload(object.path,bytes,{contentType:object.mime,upsert:false}))}
  console.log('Database and storage restored. Run access, recovery, and email checks before enabling traffic.');
 }finally{key.fill(0);await unlink(dump).catch(()=>{});await rmdir(temporary).catch(()=>{})}
}
restore(process.argv[2],process.argv.includes('--verify-only')).catch(()=>{console.error('Restore/verification failed. Do not enable traffic to this destination.');process.exitCode=1});
