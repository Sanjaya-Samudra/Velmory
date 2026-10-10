import type {SupabaseClient} from '@supabase/supabase-js';
import {authenticate,bytes,checked,clients,endpoint,HttpError,json,sha256,uuid,type Runtime} from './http.ts';
export const PRIVATE_BUCKET='velmory-private';
export interface MediaManifest {id:string;owner_id:string;bytes:number;sha256:string;state:string;purpose:string;chunks:{part:number;bytes:number;sha256:string}[]}
export const chunkPath=(owner:string,id:string,part:number)=>`${owner}/${id}/${part}`;
export async function readMedia(admin:SupabaseClient,m:MediaManifest){
 const result=new Uint8Array(m.bytes);let offset=0;
 for(let part=0;part<Math.ceil(m.bytes/524288);part++){
  const c=m.chunks.find(c=>c.part===part);if(!c)throw new HttpError(409,'Upload is incomplete');
  const blob=checked(await admin.storage.from(PRIVATE_BUCKET).download(chunkPath(m.owner_id,m.id,part)));if(!blob)throw new HttpError(409,'Chunk unavailable');
  const data=new Uint8Array(await blob.arrayBuffer());if(data.length!==c.bytes||await sha256(data)!==c.sha256)throw new HttpError(409,'Chunk integrity check failed');
  result.set(data,offset);offset+=data.length;
 }
 if(offset!==m.bytes||await sha256(result)!==m.sha256)throw new HttpError(409,'Upload integrity check failed');return result;
}
export function mediaHandler(runtime:Runtime){return endpoint(runtime,async req=>{
 const {user,admin}=clients(runtime,req);const account=await authenticate(user);const url=new URL(req.url),action=url.searchParams.get('action');
 if(req.method==='POST'&&action==='reserve'){
  const body=await json(req);const id=uuid(body.id);const result=checked(await user.rpc('reserve_media',{p_id:id,p_bytes:body.bytes,p_sha256:body.sha256,p_purpose:body.purpose}));return Response.json(result);
 }
 const id=uuid(url.searchParams.get('id'));
 if(req.method==='DELETE') {checked(await user.rpc('delete_media',{p_id:id}));return Response.json({queued:true})}
 const writing=req.method==='PUT'||(req.method==='POST'&&action==='commit');
 // A ready upload may safely acknowledge a repeated commit.
 let manifest=checked(await user.rpc('media_access',{p_id:id,p_write:false})) as MediaManifest;
 if(req.method==='GET'&&action==='status'){
  if(manifest.owner_id!==account.id)throw new HttpError(403,'Upload status is private');
  return Response.json({id,state:manifest.state,bytes:manifest.bytes,sha256:manifest.sha256,chunks:manifest.chunks});
 }
 if(req.method==='POST'&&action==='commit'&&manifest.state==='ready'&&manifest.owner_id===account.id)return Response.json({id,state:'ready'});
 if(writing)manifest=checked(await user.rpc('media_access',{p_id:id,p_write:true})) as MediaManifest;
 if(req.method==='PUT'&&action==='chunk'){
  const rawPart=url.searchParams.get('part');if(!rawPart||!/^\d+$/.test(rawPart))throw new HttpError(400,'Invalid chunk');const part=Number(rawPart);
  const expected=Math.min(524288,manifest.bytes-part*524288);if(part<0||part>=16||expected<=0)throw new HttpError(400,'Invalid chunk');
  const content=await bytes(req,524288);if(content.length!==expected)throw new HttpError(400,'Invalid chunk size');const hash=await sha256(content);
  const existing=manifest.chunks.find(c=>c.part===part);if(existing){if(existing.sha256!==hash)throw new HttpError(409,'Chunk conflict');return Response.json({part,sha256:hash})}
  const path=chunkPath(account.id,id,part);const uploaded=await admin.storage.from(PRIVATE_BUCKET).upload(path,content,{contentType:'application/octet-stream',upsert:false});
  if(uploaded.error){const found=await admin.storage.from(PRIVATE_BUCKET).download(path);if(found.error||!found.data||await sha256(new Uint8Array(await found.data.arrayBuffer()))!==hash)throw new HttpError(409,'Chunk could not be stored')}
  checked(await admin.rpc('record_media_chunk',{p_owner:account.id,p_id:id,p_part:part,p_bytes:content.length,p_sha256:hash}));
  return Response.json({part,sha256:hash});
 }
 if(req.method==='POST'&&action==='commit'){
  await readMedia(admin,manifest);checked(await admin.rpc('commit_media',{p_owner:account.id,p_id:id,p_sha256:manifest.sha256}));return Response.json({id,state:'ready'});
 }
 if(req.method==='GET'&&action==='download'){
  if(manifest.state!=='ready')throw new HttpError(409,'Upload not complete');const content=await readMedia(admin,manifest);
  // Recheck after I/O so cancellation/suspension during retrieval is observed.
  checked(await user.rpc('media_access',{p_id:id,p_write:false}));
  return new Response(content,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="encrypted-media.bin"'}});
 }
 throw new HttpError(405,'Unsupported media operation');
})}
