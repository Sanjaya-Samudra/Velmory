import {it,expect} from 'vitest';
import {mediaHandler} from '../supabase/functions/_shared/media';
import {dispatchHandler} from '../supabase/functions/_shared/dispatch';
import {deletionHandler} from '../supabase/functions/_shared/maintenance';
import {artworkHandler} from '../supabase/functions/_shared/artwork';
import {sha256,type Runtime} from '../supabase/functions/_shared/http';
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002';
const id='00000000-0000-4000-8000-000000000010';
function harness(){
 const values:Record<string,string>={SUPABASE_URL:'https://local.example',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'service-key',SCHEDULER_SECRET:'scheduler-secret',APP_URL:'https://app.example',BREVO_API_KEY:'brevo-key',MAIL_FROM:'mail@example.test'};
 let manifest:any;let allowed=true;let authenticated=true;let providerStatus=201;
 const blobs=new Map<string,Uint8Array>();const calls:{name:string;body:any}[]=[];const emails:any[]=[];
 const runtime:Runtime={env:name=>values[name],fetch:async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url),path=url.pathname;
  if(url.hostname==='api.brevo.com'){emails.push(await req.json());return Response.json({messageId:'test'},{status:providerStatus})}
  if(path==='/auth/v1/user')return authenticated?Response.json({id:alice,aud:'authenticated',email:'alice@example.test'}):Response.json({message:'Unauthorized'},{status:401});
  if(path.startsWith('/rest/v1/rpc/')){
   const name=path.split('/').at(-1)!;const body=await req.json();calls.push({name,body});
   if(name==='reserve_media'){manifest={id:body.p_id,owner_id:alice,bytes:body.p_bytes,sha256:body.p_sha256,purpose:body.p_purpose,state:'reserved',chunks:[]};return Response.json({id:body.p_id,state:'reserved'})}
   if(name==='media_access'){if(!allowed)return Response.json({message:'Media unavailable'},{status:403});return Response.json(manifest)}
   if(name==='record_media_chunk'){manifest.chunks.push({part:body.p_part,bytes:body.p_bytes,sha256:body.p_sha256});return Response.json(null)}
   if(name==='commit_media'){manifest.state='ready';return Response.json(null)}
   if(name==='claim_notification_jobs')return Response.json([{id,token:bob}]);
   if(name==='prepare_notification')return Response.json(allowed?{email:'recipient@example.test',enabled:true,kind:'release'}:null);
   if(name==='asset_access')return Response.json(null);
   if(name==='is_admin')return Response.json(false);
   return Response.json(null);
  }
  if(path.startsWith('/storage/v1/object/')){
   const key=path.replace('/storage/v1/object/authenticated/','').replace('/storage/v1/object/','');
   if(req.method==='POST'){if(blobs.has(key))return Response.json({message:'Duplicate',statusCode:'409'},{status:409});blobs.set(key,new Uint8Array(await req.arrayBuffer()));return Response.json({Key:key,Id:id})}
   if(req.method==='GET')return blobs.has(key)?new Response(blobs.get(key)!):Response.json({message:'Not found'},{status:404});
  }
  if(path.startsWith('/rest/v1/'))return Response.json(null);
  throw new Error('Unexpected test request: '+path);
 }};
 const request=(action:string,method='GET',body?:BodyInit,part?:number)=>new Request(`https://local.example/functions/v1/media?action=${action}&id=${id}${part===undefined?'':'&part='+part}`,{method,body,headers:{Authorization:'Bearer user-token'}});
 return {runtime,values,request,blobs,calls,emails,get manifest(){return manifest},setAllowed:(v:boolean)=>allowed=v,setAuthenticated:(v:boolean)=>authenticated=v,setProviderStatus:(v:number)=>providerStatus=v};
}
it('resumes encrypted chunks and verifies the complete ciphertext before commit',async()=>{
 const h=harness(),handle=mediaHandler(h.runtime),data=new Uint8Array(524300).fill(37);const hash=await sha256(data);
 expect((await handle(h.request('reserve','POST',JSON.stringify({id,bytes:data.length,sha256:hash,purpose:'diary'})))).status).toBe(200);
 expect((await handle(h.request('chunk','PUT',data.slice(0,524288),0))).status).toBe(200);
 expect((await handle(h.request('commit','POST'))).status).toBe(409);
 expect((await handle(h.request('chunk','PUT',data.slice(0,524288),0))).status).toBe(200);
 expect((await handle(h.request('chunk','PUT',data.slice(524288),1))).status).toBe(200);
 expect((await handle(h.request('commit','POST'))).status).toBe(200);expect(h.manifest.state).toBe('ready');
 const download=await handle(h.request('download'));expect(download.status).toBe(200);expect(new Uint8Array(await download.arrayBuffer())).toEqual(data);
 h.setAllowed(false);expect((await handle(h.request('download'))).status).toBe(409);
});
it('rejects oversized chunks and tampered ciphertext',async()=>{
 const h=harness(),handle=mediaHandler(h.runtime),data=new Uint8Array(64).fill(4);
 await handle(h.request('reserve','POST',JSON.stringify({id,bytes:64,sha256:await sha256(data),purpose:'letter'})));
 expect((await handle(h.request('chunk','PUT',new Uint8Array(524289),0))).status).toBe(413);
 await handle(h.request('chunk','PUT',data,0));h.blobs.set('velmory-private/'+alice+'/'+id+'/0',new Uint8Array(64));
 expect((await handle(h.request('commit','POST'))).status).toBe(409);expect(h.calls.some(c=>c.name==='commit_media')).toBe(false);
});
it('requires authentication and rejects foreign origins',async()=>{
 const h=harness(),handle=mediaHandler(h.runtime);h.setAuthenticated(false);const denied=await handle(h.request('status'));expect(denied.status).toBe(401);expect(denied.headers.get('Cache-Control')).toBe('no-store');expect(denied.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
 const response=await handle(new Request('https://local.example/functions/v1/media',{method:'OPTIONS',headers:{Origin:'https://evil.example'}}));expect(response.status).toBe(403);
});
it('releases letters even when email configuration is unavailable',async()=>{
 const h=harness();delete h.values.BREVO_API_KEY;const result=await dispatchHandler(h.runtime)(new Request('https://local.example/functions/v1/letter-dispatch',{method:'POST',headers:{Authorization:'Bearer scheduler-secret'}}));
 expect(result.status).toBe(503);expect(h.calls.map(c=>c.name)).toContain('release_due_letters');expect(h.calls.map(c=>c.name)).not.toContain('claim_notification_jobs');
});
it('sends only generic notifications and records retryable provider failures',async()=>{
 const h=harness();h.setProviderStatus(503);const result=await dispatchHandler(h.runtime)(new Request('https://local.example/functions/v1/letter-dispatch',{method:'POST',headers:{Authorization:'Bearer scheduler-secret'}}));expect(result.status).toBe(200);
 expect(h.emails).toHaveLength(1);expect(h.emails[0].headers.idempotencyKey).toBe(id);expect(h.emails[0]).not.toHaveProperty('attachment');expect(h.calls.find(c=>c.name==='finish_notification')?.body.p_result).toBe('provider_rejected');
});
it('does not send a claimed notification cancelled before dispatch',async()=>{
 const h=harness();h.setAllowed(false);await dispatchHandler(h.runtime)(new Request('https://local.example/functions/v1/letter-dispatch',{method:'POST',headers:{Authorization:'Bearer scheduler-secret'}}));expect(h.emails).toHaveLength(0);expect(h.calls.find(c=>c.name==='finish_notification')?.body.p_result).toBe('cancelled');
});
it('queues account cleanup rather than falsely claiming immediate deletion',async()=>{const h=harness();const response=await deletionHandler(h.runtime)(new Request('https://local.example/functions/v1/account-delete',{method:'POST',headers:{Authorization:'Bearer user-token'}}));expect(response.status).toBe(202);expect(await response.json()).toMatchObject({deleted:false,pending:true});expect(h.calls.map(c=>c.name)).toContain('begin_account_deletion')});
it('protects draft artwork and administrator upload endpoints',async()=>{const h=harness(),handle=artworkHandler(h.runtime);expect((await handle(new Request('https://local.example/functions/v1/artwork?id='+id))).status).toBe(404);expect((await handle(new Request('https://local.example/functions/v1/artwork?id='+id,{method:'PUT',body:'<svg/>',headers:{Authorization:'Bearer user-token'}}))).status).toBe(403)});
