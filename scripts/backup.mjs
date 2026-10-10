// Run only during the documented maintenance window. Secrets come from env.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {backupKey,encryptBuffer,encryptStream,fileHash,digest} from './backup-format.mjs';
const check=r=>{if(r.error)throw Error('Backup service operation failed');return r.data};
export async function backup(destination){
 if(process.env.VELMORY_MAINTENANCE_CONFIRMED!=='yes')throw Error('Quiesce writes and scheduler workers first; see docs/BACKEND.md. Then set VELMORY_MAINTENANCE_CONFIRMED=yes.');
 const key=backupKey(),url=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!secret||!destination)throw Error('Supply SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PostgreSQL PG* variables and an output directory.');
 const root=resolve(destination);await mkdir(root,{recursive:false,mode:0o700});const manifest={format:'velmory-operator-backup',version:1,createdAt:new Date().toISOString(),database:{file:'database.enc',sha256:''},objects:[]};
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 if(!check(await admin.from('service_settings').select('maintenance').eq('singleton',true).single())?.maintenance)throw Error('Source service must be in maintenance mode.');
 const child=spawn('pg_dump',['--format=custom','--no-owner','--schema=public','--schema=auth'],{stdio:['ignore','pipe','pipe'],windowsHide:true});child.stderr.resume();
 const finished=new Promise((resolve,reject)=>{child.on('error',()=>reject(Error('pg_dump unavailable')));child.on('exit',code=>code===0?resolve():reject(Error('pg_dump failed; backup is incomplete')))});
 await Promise.all([encryptStream(child.stdout,join(root,'database.enc'),key),finished]);manifest.database.sha256=await fileHash(join(root,'database.enc'));
 async function walk(bucket,prefix=''){
  for(let offset=0;;offset+=100){const items=check(await admin.storage.from(bucket).list(prefix,{limit:100,offset,sortBy:{column:'name',order:'asc'}}));for(const item of items??[]){const path=prefix?prefix+'/'+item.name:item.name;if(!item.id){await walk(bucket,path);continue}const blob=check(await admin.storage.from(bucket).download(path));const bytes=Buffer.from(await blob.arrayBuffer()),file=`object-${manifest.objects.length}.enc`;await writeFile(join(root,file),encryptBuffer(bytes,key),{flag:'wx',mode:0o600});manifest.objects.push({bucket,path,file,bytes:bytes.length,sha256:digest(bytes),mime:blob.type||'application/octet-stream'})}if(!items||items.length<100)break}
 }
 await walk('velmory-private');await walk('velmory-artwork');
 // Written last: missing manifest means an incomplete, non-restorable backup.
 await writeFile(join(root,'manifest.enc'),encryptBuffer(Buffer.from(JSON.stringify(manifest)),key),{flag:'wx',mode:0o600});key.fill(0);
 console.log(`Encrypted backup complete: ${manifest.objects.length} storage objects.`);
}
if(process.argv[1]&&import.meta.url.endsWith('/backup.mjs'))backup(process.argv[2]).catch(()=>{console.error('Backup failed. Keep the source service intact; this output is not a verified backup.');process.exitCode=1});
