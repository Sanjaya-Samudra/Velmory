// Service adapter only: no visual changes to the existing editor.
import {backend,checkError} from './backend';
import {db} from './db';
import {encrypt,decrypt,encryptBytes,decryptBytes} from './crypto';
import type {CipherEnvelope} from './types';
export interface MediaReference {id:string;owner:string;sha256:string;bytes:number}
async function hash(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('')}
async function request(action:string,init:RequestInit={},id?:string,part?:number){
 if(!backend)throw new Error('Cloud service is not configured.');
 const {data,error}=await backend.auth.getSession();checkError(error);if(!data.session)throw new Error('Sign in before synchronizing media.');
 const url=new URL(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/media');url.searchParams.set('action',action);if(id)url.searchParams.set('id',id);if(part!==undefined)url.searchParams.set('part',String(part));
 const response=await fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer '+data.session.access_token,apikey:import.meta.env.VITE_SUPABASE_ANON_KEY}});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error??'Media operation failed. Your local encrypted copy is retained.')}return response;
}
export async function stagePrivateMedia(owner:string,key:Uint8Array,content:{mime:string;data:string},purpose:'diary'|'letter'='diary'):Promise<MediaReference>{
 const id=crypto.randomUUID();const envelope=await encrypt(content,key,owner+':media:'+id),bytes=new TextEncoder().encode(JSON.stringify(envelope));
 if(bytes.length>8388608)throw new Error('Encrypted media exceeds the 8 MiB limit.');const sha256=await hash(bytes);
 await db.uploads.put({owner,id,bytes,sha256,purpose,state:'pending'});return {id,owner,bytes:bytes.length,sha256};
}
export async function stagePrivateBytes(owner:string,key:Uint8Array,content:Uint8Array,purpose:'diary'|'letter'='diary'):Promise<MediaReference>{const id=crypto.randomUUID(),bytes=await encryptBytes(content,key,owner+':media:'+id);if(bytes.length>8388608)throw new Error('Encrypted media exceeds the 8 MiB limit.');const sha256=await hash(bytes);await db.uploads.put({owner,id,bytes,sha256,purpose,state:'pending'});return {id,owner,bytes:bytes.length,sha256}}
export async function synchronizeMedia(owner:string,id:string){
 const local=await db.uploads.get([owner,id]);if(!local)throw new Error('Encrypted upload is not cached.');
 if(local.state==='deleting'){if(backend&&navigator.onLine)await request('delete',{method:'DELETE'},id);await db.uploads.delete([owner,id]);return}
 await request('reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,bytes:local.bytes.length,sha256:local.sha256,purpose:local.purpose})});
 const status=await (await request('status',{},id)).json() as {state:string;chunks:{part:number;sha256:string}[]};
 if(status.state!=='ready'){
  for(let offset=0,part=0;offset<local.bytes.length;offset+=524288,part++){
   const chunk=local.bytes.slice(offset,offset+524288),existing=status.chunks.find(c=>c.part===part);
   if(existing){if(existing.sha256!==await hash(chunk))throw new Error('Upload conflict; the cached ciphertext differs.');continue}
   await request('chunk',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:chunk},id,part);
  }
  await request('commit',{method:'POST'},id);
 }
 await db.uploads.update([owner,id],{state:'ready'});
}
export async function readPrivateMedia<T>(reference:MediaReference,key:Uint8Array):Promise<T>{
 let local=await db.uploads.get([reference.owner,reference.id]);
 if(!local){const bytes=new Uint8Array(await (await request('download',{},reference.id)).arrayBuffer());if(await hash(bytes)!==reference.sha256||bytes.length!==reference.bytes)throw new Error('Media integrity check failed.');local={id:reference.id,owner:reference.owner,bytes,sha256:reference.sha256,purpose:'diary',state:'ready'};await db.uploads.put(local)}
 if(local.sha256!==reference.sha256||await hash(local.bytes)!==reference.sha256)throw new Error('Cached media integrity check failed.');
 return decrypt<T>(JSON.parse(new TextDecoder().decode(local.bytes)) as CipherEnvelope,key,reference.owner+':media:'+reference.id);
}
export async function readPrivateBytes(reference:MediaReference,key:Uint8Array){let local=await db.uploads.get([reference.owner,reference.id]);if(!local){const bytes=new Uint8Array(await (await request('download',{},reference.id)).arrayBuffer());if(await hash(bytes)!==reference.sha256||bytes.length!==reference.bytes)throw new Error('Media integrity check failed.');local={id:reference.id,owner:reference.owner,bytes,sha256:reference.sha256,purpose:'diary',state:'ready'};await db.uploads.put(local)}if(local.sha256!==reference.sha256||await hash(local.bytes)!==reference.sha256)throw new Error('Cached media integrity check failed.');return decryptBytes(local.bytes,key,reference.owner+':media:'+reference.id)}
export async function queuePrivateMediaRemoval(owner:string,id:string){const local=await db.uploads.get([owner,id]);if(owner.startsWith('device:')){if(local)await db.uploads.delete([owner,id]);return}if(local)await db.uploads.update([owner,id],{state:'deleting'});else if(backend&&navigator.onLine)await request('delete',{method:'DELETE'},id)}
export async function removePrivateMedia(owner:string,id:string){await queuePrivateMediaRemoval(owner,id);if(backend&&navigator.onLine)await synchronizeMedia(owner,id)}
