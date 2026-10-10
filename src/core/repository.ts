import {db,type UploadRecord} from './db';
import {encrypt,decrypt} from './crypto';
import {backend,checkError} from './backend';
import type {EncryptedRecord,CipherEnvelope} from './types';
const queues=new Map<string,Promise<void>>();
const preparing=new Set<Promise<void>>();
export function trackPrivateWrite(task:Promise<void>){preparing.add(task);return task.finally(()=>preparing.delete(task))}
export async function readDocuments<T>(owner:string,key:Uint8Array,prefix='diary:'){const rows=await db.records.where('owner').equals(owner).toArray();return Promise.all(rows.filter(r=>r.id.startsWith(prefix)&&!r.deleted).map(r=>decrypt<T>(r.envelope,key,r.owner+':'+r.id)))}
export async function readDocumentEntries<T>(owner:string,key:Uint8Array,prefix:string){const rows=await db.records.where('owner').equals(owner).toArray();return Promise.all(rows.filter(r=>r.id.startsWith(prefix)&&!r.deleted).map(async r=>({recordId:r.id,value:await decrypt<T>(r.envelope,key,r.owner+':'+r.id)})))}
export function saveDocument(owner:string,key:Uint8Array,id:string,value:unknown){
 const queueId=JSON.stringify([owner,id]),previous=queues.get(queueId)??Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{
  const envelope=await encrypt(value,key,owner+':'+id);
  await db.transaction('rw',db.records,async()=>{const old=await db.records.get([owner,id]);await db.records.put({id,owner,envelope,revision:old?.revision??0,pending:true,updatedAt:new Date().toISOString()})});
 });
 queues.set(queueId,task);return task.finally(()=>{if(queues.get(queueId)===task)queues.delete(queueId)});
}
export async function flushWrites(){await Promise.all([...preparing]);await Promise.all([...queues.values()])}
export async function deleteDocument(owner:string,key:Uint8Array,id:string){await saveDocument(owner,key,id,{deleted:true});await db.records.update([owner,id],{deleted:true,pending:true})}
export async function syncDocuments(owner:string):Promise<{conflicts:number}>{if(!backend||owner.startsWith('device:')||!navigator.onLine)return {conflicts:0};let conflicts=0;await flushWrites();const rows=await db.records.where('owner').equals(owner).toArray();for(const row of rows.filter(r=>r.pending)){const {data,error}=await backend.rpc('save_document',{p_id:row.id,p_expected_revision:row.revision,p_envelope:row.envelope,p_deleted:!!row.deleted});if(error){if(error.message.includes('revision_conflict')){conflicts++;continue}throw new Error(error.message)}await db.transaction('rw',db.records,async()=>{const current=await db.records.get([owner,row.id]);if(current){current.revision=Number(data);if(current.envelope.ciphertext===row.envelope.ciphertext)current.pending=false;await db.records.put(current)}})}let cursor=(await db.cursors.get(owner))?.value??0;let more=true;while(more){const {data,error}=await backend.rpc('fetch_changes',{p_cursor:cursor,p_limit:100});checkError(error);await db.transaction('rw',db.records,db.cursors,async()=>{for(const remote of data.records){const local=await db.records.get([owner,remote.id]);if(!local?.pending&&(!local||remote.revision>=local.revision))await db.records.put({id:remote.id,owner,envelope:remote.envelope as CipherEnvelope,revision:remote.revision,pending:false,updatedAt:remote.updated_at,deleted:remote.deleted})}await db.cursors.put({owner,value:data.cursor})});cursor=data.cursor;more=data.has_more;}return {conflicts}}
export async function conflictsFor(owner:string){if(!backend)return [];const pending=(await db.records.where('owner').equals(owner).toArray()).filter(r=>r.pending);const result:{local:EncryptedRecord;remote:EncryptedRecord}[]=[];for(const local of pending){const {data,error}=await backend.from('documents').select('*').eq('id',local.id).maybeSingle();checkError(error);if(data&&data.revision>local.revision)result.push({local,remote:{id:data.id,owner,envelope:data.envelope,revision:data.revision,pending:false,updatedAt:data.updated_at,deleted:data.deleted}})}return result}
export async function preserveConflict(owner:string,key:Uint8Array,local:EncryptedRecord,remote:EncryptedRecord){
 if(local.owner!==owner||remote.owner!==owner||local.id!==remote.id)throw new Error('Conflict belongs to a different record.');
 await flushWrites();
 const value=await decrypt<Record<string,unknown>>(local.envelope,key,owner+':'+local.id);
 const uuid=crypto.randomUUID(),id=local.id.split(':')[0]+':'+uuid;
 if(!local.deleted){const copy={...value,id:uuid,title:String(value?.title??'Memory')+' (device copy)'};await saveDocument(owner,key,id,copy)}
 await db.transaction('rw',db.records,async()=>{const current=await db.records.get([owner,local.id]);if(!current||current.envelope.ciphertext!==local.envelope.ciphertext)throw new Error('This memory changed during reconciliation. Your latest edits are safe; review again.');await db.records.put(remote)});
}
function toBase64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)}
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export async function exportArchive(owner:string){await flushWrites();return {format:'velmory-encrypted-archive',version:2,exportedAt:new Date().toISOString(),vault:await db.vaults.get(owner),documents:await db.records.where('owner').equals(owner).toArray(),media:(await db.uploads.where('owner').equals(owner).toArray()).map(row=>({...row,bytes:toBase64(row.bytes)}))}}
export async function importArchive(owner:string,key:Uint8Array,input:unknown){
 const archive=input as {format:string;version:number;vault:{owner:string};documents:EncryptedRecord[];media?:{owner:string;id:string;bytes:string;sha256:string;purpose:'diary'|'letter'}[]};
 if(!archive||archive.format!=='velmory-encrypted-archive'||![1,2].includes(archive.version)||archive.vault?.owner!==owner||!Array.isArray(archive.documents)||archive.documents.length>10000)throw new Error('This archive does not belong to this vault. Restore it using its original account and vault key.');
 const verified:EncryptedRecord[]=[];
 for(const row of archive.documents){if(row.owner!==owner||! /^(diary|letter|settings):[a-zA-Z0-9:-]{1,100}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('Invalid archive record.');await decrypt(row.envelope,key,owner+':'+row.id);verified.push(row)}
 if(archive.media!==undefined&&(!Array.isArray(archive.media)||archive.media.length>10000))throw new Error('Invalid media archive.');
 const media:UploadRecord[]=[];let total=0;
 for(const row of archive.media??[]){
  if(row.owner!==owner||typeof row.bytes!=='string'||row.bytes.length>12000000||!['diary','letter'].includes(row.purpose)||! /^[a-f0-9-]{36}$/.test(row.id))throw new Error('Invalid media archive.');
  const bytes=Uint8Array.from(atob(row.bytes),c=>c.charCodeAt(0));total+=bytes.length;
  if(total>512*1024*1024||await digest(bytes)!==row.sha256)throw new Error('Media archive integrity check failed (maximum 512 MB).');
  media.push({...row,bytes,state:'pending' as const});
 }
 await db.transaction('rw',db.records,db.uploads,async()=>{
  for(const row of verified){const current=await db.records.get([owner,row.id]);if(current&&current.envelope.ciphertext!==row.envelope.ciphertext)throw new Error('An existing memory differs from this archive. Import into a recovered empty vault to avoid overwriting it.');await db.records.put({...row,revision:current?.revision??row.revision,pending:true})}
  for(const row of media){const existing=await db.uploads.get([owner,row.id]);if(existing&&existing.sha256!==row.sha256)throw new Error('An existing attachment differs from this archive.');if(!existing)await db.uploads.put(row)}
 });
}
