import {db,type UploadRecord} from './db';
import {encrypt,decrypt} from './crypto';
import {backend,checkError} from './backend';
import type {EncryptedRecord,CipherEnvelope,Diary,DiaryPage} from './types';
import {queuePrivateMediaRemoval} from './media';
const pendingValues=new Map<string,unknown>();
const drains=new Map<string,Promise<void>>();
const preparing=new Set<Promise<void>>();
const diaryCache=new Map<string,Diary>();
export function trackPrivateWrite(task:Promise<void>){preparing.add(task);return task.finally(()=>preparing.delete(task))}
export async function readDocuments<T>(owner:string,key:Uint8Array,prefix='diary:'){const rows=await db.records.where('owner').equals(owner).toArray();return Promise.all(rows.filter(r=>r.id.startsWith(prefix)&&!r.deleted).map(r=>decrypt<T>(r.envelope,key,r.owner+':'+r.id)))}
export async function readDocumentEntries<T>(owner:string,key:Uint8Array,prefix:string){const rows=await db.records.where('owner').equals(owner).toArray();return Promise.all(rows.filter(r=>r.id.startsWith(prefix)&&!r.deleted).map(async r=>({recordId:r.id,value:await decrypt<T>(r.envelope,key,r.owner+':'+r.id)})))}
interface DiaryMeta {v:2;id:string;title:string;cover:Diary['cover'];coverArt?:string;createdAt:string;archived:boolean;pageIds:string[]}
const cacheId=(owner:string,id:string)=>owner+':'+id;
const metaFrom=(diary:Diary):DiaryMeta=>({v:2,id:diary.id,title:diary.title,cover:diary.cover,coverArt:diary.coverArt,createdAt:diary.createdAt,archived:diary.archived,pageIds:diary.pages.map(page=>page.id)});
const audioIds=(diary:Diary|undefined)=>new Set(diary?.pages.flatMap(page=>page.objects.flatMap(object=>object.audio?.parts.map(part=>part.id)??[]))??[]);
export async function readDiaries(owner:string,key:Uint8Array){
 const records=await db.records.where('owner').equals(owner).toArray(),metas=records.filter(row=>row.id.startsWith('diary-meta:')&&!row.deleted),pageRows=new Map(records.filter(row=>row.id.startsWith('diary-page:')&&!row.deleted).map(row=>[row.id,row]));
 const result:Diary[]=[];for(const row of metas){const meta=await decrypt<DiaryMeta>(row.envelope,key,owner+':'+row.id),pages:DiaryPage[]=[];for(const id of meta.pageIds){const pageRow=pageRows.get(`diary-page:${meta.id}:${id}`);if(pageRow)pages.push(await decrypt<DiaryPage>(pageRow.envelope,key,owner+':'+pageRow.id))}const diary:Diary={id:meta.id,title:meta.title,cover:meta.cover,coverArt:meta.coverArt,createdAt:meta.createdAt,archived:meta.archived,pages};result.push(diary);diaryCache.set(cacheId(owner,diary.id),structuredClone(diary))}
 const legacy=records.filter(row=>row.id.startsWith('diary:')&&!row.deleted);for(const row of legacy){const diary=await decrypt<Diary>(row.envelope,key,owner+':'+row.id);if(!result.some(item=>item.id===diary.id)){await saveDiary(owner,key,diary);await deleteDocument(owner,key,row.id);result.push(diary)}}
 return result;
}
export async function saveDiary(owner:string,key:Uint8Array,diary:Diary){
 const previous=diaryCache.get(cacheId(owner,diary.id)),nextPageIds=new Set(diary.pages.map(page=>page.id)),tasks:Promise<void>[]=[];
 if(!previous||JSON.stringify(metaFrom(previous))!==JSON.stringify(metaFrom(diary)))tasks.push(saveDocument(owner,key,'diary-meta:'+diary.id,metaFrom(diary)));
 const oldPages=new Map(previous?.pages.map(page=>[page.id,page])??[]);for(const page of diary.pages){if(JSON.stringify(oldPages.get(page.id))!==JSON.stringify(page))tasks.push(saveDocument(owner,key,`diary-page:${diary.id}:${page.id}`,page))}
 for(const page of previous?.pages??[]){if(!nextPageIds.has(page.id))tasks.push(deleteDocument(owner,key,`diary-page:${diary.id}:${page.id}`))}
 const retained=audioIds(diary);for(const id of audioIds(previous))if(!retained.has(id))await queuePrivateMediaRemoval(owner,id);
 await Promise.all(tasks);diaryCache.set(cacheId(owner,diary.id),structuredClone(diary));
}
export async function deleteDiary(owner:string,key:Uint8Array,diary:Diary){
 for(const id of audioIds(diary))await queuePrivateMediaRemoval(owner,id);
 await Promise.all([deleteDocument(owner,key,'diary-meta:'+diary.id),...diary.pages.map(page=>deleteDocument(owner,key,`diary-page:${diary.id}:${page.id}`))]);diaryCache.delete(cacheId(owner,diary.id));
}
export function saveDocument(owner:string,key:Uint8Array,id:string,value:unknown){
 const queueId=JSON.stringify([owner,id]);pendingValues.set(queueId,value);let drain=drains.get(queueId);if(!drain){drain=(async()=>{try{while(pendingValues.has(queueId)){const next=pendingValues.get(queueId);pendingValues.delete(queueId);const envelope=await encrypt(next,key,owner+':'+id);await db.transaction('rw',db.records,async()=>{const old=await db.records.get([owner,id]);await db.records.put({id,owner,envelope,revision:old?.revision??0,pending:true,updatedAt:new Date().toISOString()})})}}finally{drains.delete(queueId)}})();drains.set(queueId,drain)}return drain;
}
export async function flushWrites(){await Promise.all([...preparing]);while(drains.size)await Promise.all([...drains.values()])}
export async function deleteDocument(owner:string,key:Uint8Array,id:string){await saveDocument(owner,key,id,{deleted:true});await db.records.update([owner,id],{deleted:true,pending:true})}
export async function syncDocuments(owner:string):Promise<{conflicts:number}>{if(!backend||owner.startsWith('device:')||!navigator.onLine)return {conflicts:0};let conflicts=0;await flushWrites();const rows=await db.records.where('owner').equals(owner).toArray();for(const row of rows.filter(r=>r.pending)){const {data,error}=await backend.rpc('save_document',{p_id:row.id,p_expected_revision:row.revision,p_envelope:row.envelope,p_deleted:!!row.deleted});if(error){if(error.message.includes('revision_conflict')){conflicts++;continue}throw new Error(error.message)}await db.transaction('rw',db.records,async()=>{const current=await db.records.get([owner,row.id]);if(current){current.revision=Number(data);if(current.envelope.ciphertext===row.envelope.ciphertext)current.pending=false;await db.records.put(current)}})}let cursor=(await db.cursors.get(owner))?.value??0;let more=true;while(more){const {data,error}=await backend.rpc('fetch_changes',{p_cursor:cursor,p_limit:100});checkError(error);await db.transaction('rw',db.records,db.cursors,async()=>{for(const remote of data.records){const local=await db.records.get([owner,remote.id]);if(!local?.pending&&(!local||remote.revision>=local.revision))await db.records.put({id:remote.id,owner,envelope:remote.envelope as CipherEnvelope,revision:remote.revision,pending:false,updatedAt:remote.updated_at,deleted:remote.deleted})}await db.cursors.put({owner,value:data.cursor})});cursor=data.cursor;more=data.has_more;}return {conflicts}}
export async function conflictsFor(owner:string){if(!backend)return [];const pending=(await db.records.where('owner').equals(owner).toArray()).filter(r=>r.pending);const result:{local:EncryptedRecord;remote:EncryptedRecord}[]=[];for(const local of pending){const {data,error}=await backend.from('documents').select('*').eq('id',local.id).maybeSingle();checkError(error);if(data&&data.revision>local.revision)result.push({local,remote:{id:data.id,owner,envelope:data.envelope,revision:data.revision,pending:false,updatedAt:data.updated_at,deleted:data.deleted}})}return result}
export async function preserveConflict(owner:string,key:Uint8Array,local:EncryptedRecord,remote:EncryptedRecord){
 if(local.owner!==owner||remote.owner!==owner||local.id!==remote.id)throw new Error('Conflict belongs to a different record.');
 await flushWrites();
 const value=await decrypt<Record<string,unknown>>(local.envelope,key,owner+':'+local.id);
 if(!local.deleted&&local.id.startsWith('diary-page:')){const [,diaryId]=local.id.split(':'),uuid=crypto.randomUUID(),copy={...value,id:uuid,title:String(value?.title??'Memory')+' (device copy)'};await saveDocument(owner,key,`diary-page:${diaryId}:${uuid}`,copy);const metaId='diary-meta:'+diaryId,metaRow=await db.records.get([owner,metaId]);if(metaRow&&!metaRow.deleted){const meta=await decrypt<DiaryMeta>(metaRow.envelope,key,owner+':'+metaId);await saveDocument(owner,key,metaId,{...meta,pageIds:[...meta.pageIds,uuid]})}}
 else if(!local.deleted&&!local.id.startsWith('diary-meta:')){const uuid=crypto.randomUUID(),id=local.id.split(':')[0]+':'+uuid;await saveDocument(owner,key,id,{...value,id:uuid,title:String(value?.title??'Memory')+' (device copy)'})}
 await db.transaction('rw',db.records,async()=>{const current=await db.records.get([owner,local.id]);if(!current||current.envelope.ciphertext!==local.envelope.ciphertext)throw new Error('This memory changed during reconciliation. Your latest edits are safe; review again.');await db.records.put(remote)});
}
function toBase64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)}
async function digest(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export async function exportArchive(owner:string){await flushWrites();return {format:'velmory-encrypted-archive',version:2,exportedAt:new Date().toISOString(),vault:await db.vaults.get(owner),documents:await db.records.where('owner').equals(owner).toArray(),media:(await db.uploads.where('owner').equals(owner).toArray()).map(row=>({...row,bytes:toBase64(row.bytes)}))}}
export async function importArchive(owner:string,key:Uint8Array,input:unknown){
 const archive=input as {format:string;version:number;vault:{owner:string};documents:EncryptedRecord[];media?:{owner:string;id:string;bytes:string;sha256:string;purpose:'diary'|'letter'}[]};
 if(!archive||archive.format!=='velmory-encrypted-archive'||![1,2].includes(archive.version)||archive.vault?.owner!==owner||!Array.isArray(archive.documents)||archive.documents.length>10000)throw new Error('This archive does not belong to this vault. Restore it using its original account and vault key.');
 const verified:EncryptedRecord[]=[];
 for(const row of archive.documents){if(row.owner!==owner||! /^(diary|diary-meta|diary-page|letter|settings):[a-zA-Z0-9:-]{1,180}$/.test(row.id)||!Number.isSafeInteger(row.revision)||row.revision<0)throw new Error('Invalid archive record.');await decrypt(row.envelope,key,owner+':'+row.id);verified.push(row)}
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
