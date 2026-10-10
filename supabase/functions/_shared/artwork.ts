import {authenticate,bytes,checked,clients,endpoint,HttpError,sha256,uuid,type Runtime} from './http.ts';
export function imageType(data:Uint8Array){
 if(data.length<16)throw new HttpError(400,'Image is invalid');
 if([137,80,78,71,13,10,26,10].every((n,i)=>data[i]===n))return 'image/png';
 if(data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
 if(new TextDecoder().decode(data.slice(0,4))==='RIFF'&&new TextDecoder().decode(data.slice(8,12))==='WEBP')return 'image/webp';
 throw new HttpError(400,'Only PNG, JPEG, and WebP artwork is accepted');
}
export function artworkHandler(runtime:Runtime){return endpoint(runtime,async req=>{
 const {user,admin}=clients(runtime,req);const id=uuid(new URL(req.url).searchParams.get('id'));
 if(req.method==='GET'){
  const asset=checked(await user.rpc('asset_access',{p_id:id}));if(!asset)throw new HttpError(404,'Artwork unavailable');
  const blob=checked(await admin.storage.from('velmory-artwork').download(asset.path));return new Response(blob,{headers:{'Content-Type':asset.mime,'Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 const actor=await authenticate(user);if(!checked(await user.rpc('is_admin')))throw new HttpError(403,'Administrator verification required');
 if(req.method==='PUT'){
  const content=await bytes(req,5242880);const mime=imageType(content),hash=await sha256(content);const path=`${id}/${hash}`;
  const existing=checked(await admin.from('public_assets').select('*').eq('id',id).maybeSingle());
  if(existing){if(existing.sha256!==hash)throw new HttpError(409,'Use a new asset identifier for revisions');return Response.json({id})}
  const saved=await admin.storage.from('velmory-artwork').upload(path,content,{contentType:mime,upsert:false});
  if(saved.error){const old=await admin.storage.from('velmory-artwork').download(path);if(old.error||!old.data||await sha256(new Uint8Array(await old.data.arrayBuffer()))!==hash)throw new HttpError(409,'Artwork upload failed')}
  checked(await user.rpc('admin_register_artwork',{p_id:id,p_mime:mime,p_bytes:content.length,p_sha256:hash}));return Response.json({id});
 }
 throw new HttpError(405,'GET or PUT required');
})}
