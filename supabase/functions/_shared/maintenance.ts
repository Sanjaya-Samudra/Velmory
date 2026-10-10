import type {SupabaseClient} from '@supabase/supabase-js';
import {authenticate,checked,clients,endpoint,HttpError,schedulerAuthorized,type Runtime} from './http.ts';
import {PRIVATE_BUCKET} from './media.ts';
// Always remove through Storage API: deleting SQL metadata alone leaves blobs.
export async function removePrefix(admin:SupabaseClient,prefix:string){
 for(let batch=0;batch<20;batch++){
  const items=checked(await admin.storage.from(PRIVATE_BUCKET).list(prefix,{limit:100,sortBy:{column:'name',order:'asc'}}))??[];
  if(!items.length)return;
  const files:string[]=[];
  for(const item of items){const path=`${prefix}/${item.name}`;if(item.id)files.push(path);else await removePrefix(admin,path)}
  if(files.length)checked(await admin.storage.from(PRIVATE_BUCKET).remove(files));
 }
 throw new HttpError(503,'Cleanup requires another attempt');
}
export async function cleanupAccount(admin:SupabaseClient,owner:string){
 await removePrefix(admin,owner);const result=await admin.auth.admin.deleteUser(owner);
 if(result.error)throw new HttpError(503,'Account deletion is pending; cleanup will retry');
}
export function deletionHandler(runtime:Runtime){return endpoint(runtime,async req=>{
 if(req.method!=='POST')throw new HttpError(405,'POST required');
 const {user}=clients(runtime,req);await authenticate(user);checked(await user.rpc('begin_account_deletion'));
 // A grace period allows in-flight uploads to finish before namespace cleanup.
 return Response.json({deleted:false,pending:true,message:'Account access is disabled. Permanent deletion is queued.'},{status:202});
})}
export function maintenanceHandler(runtime:Runtime){return endpoint(runtime,async req=>{
 schedulerAuthorized(req,runtime);const {admin}=clients(runtime,req);if(checked(await admin.from('service_settings').select('maintenance').eq('singleton',true).single())?.maintenance)return Response.json({maintenance:true},{status:503});let removed=0,accounts=0;
 const cutoff=new Date(Date.now()-15*60000).toISOString();
 checked(await admin.from('media_objects').update({state:'deleting'}).eq('state','reserved').lt('expires_at',new Date().toISOString()));
 const media=checked(await admin.from('media_objects').select('id,owner_id').eq('state','deleting').lt('cleanup_after',new Date().toISOString()).limit(50))??[];
 for(const m of media){await removePrefix(admin,`${m.owner_id}/${m.id}`);checked(await admin.from('media_objects').delete().eq('id',m.id).eq('state','deleting'));removed++}
 const deletions=checked(await admin.from('account_deletions').select('owner_id').lt('requested_at',cutoff).limit(5))??[];
 for(const d of deletions){await cleanupAccount(admin,d.owner_id);accounts++}
 const roots=checked(await admin.storage.from(PRIVATE_BUCKET).list('',{limit:100,sortBy:{column:'name',order:'asc'}}))??[];
 for(const root of roots){if(!/^[0-9a-f-]{36}$/.test(root.name))continue;const profile=checked(await admin.from('profiles').select('id').eq('id',root.name).maybeSingle());if(!profile)await removePrefix(admin,root.name)}
 checked(await admin.from('rate_windows').delete().lt('day',new Date(Date.now()-7*86400000).toISOString().slice(0,10)));
 checked(await admin.from('service_health').upsert({name:'maintenance',last_run:new Date().toISOString(),status:'ok',code:null}));
 return Response.json({media_removed:removed,accounts_deleted:accounts});
})}
