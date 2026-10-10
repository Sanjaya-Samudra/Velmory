// Opt-in only. This suite creates and removes test accounts in a disposable project.
import {beforeAll,afterAll,it,expect} from 'vitest';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {createHash,randomBytes} from 'node:crypto';
import {createVault,encrypt,decrypt,randomContentKey,encodeKey,decodeKey,sealForRecipient,openReceived} from '../../src/core/crypto';
const url=process.env.SUPABASE_URL??'',anon=process.env.SUPABASE_ANON_KEY??'',service=process.env.SUPABASE_SERVICE_ROLE_KEY??'';
let admin:SupabaseClient;let originalGate=false;let gateChanged=false;
const accounts:{id:string;email:string;client:SupabaseClient;token:string}[]=[];
const objects:string[]=[];
const requireSuccess=(r:{error:unknown})=>{if(r.error)throw new Error('Live Supabase operation failed; verify migrations, secrets and configuration.')};
beforeAll(async()=>{
 if(process.env.VELMORY_LIVE_TEST_CONFIRM!=='DISPOSABLE_PROJECT'||!url||!anon||!service)throw new Error('This suite requires a disposable migrated project, deployed functions, service credentials, and VELMORY_LIVE_TEST_CONFIRM=DISPOSABLE_PROJECT.');
 admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const existing=await admin.auth.admin.listUsers({page:1,perPage:1});requireSuccess(existing);if(existing.data.users.length)throw new Error('Live test refuses a project containing existing accounts.');
 const settings=await admin.from('service_settings').select('email_signup_enabled').eq('singleton',true).single();requireSuccess(settings);originalGate=settings.data!.email_signup_enabled;
 requireSuccess(await admin.from('service_settings').update({email_signup_enabled:true}).eq('singleton',true));gateChanged=true;
 for(let i=0;i<2;i++){
  const email=`velmory-test-${randomBytes(12).toString('hex')}@example.invalid`,password=randomBytes(24).toString('base64url');
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});requireSuccess(created);if(!created.data.user)throw Error('Test user creation failed');
  const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const entry={id:created.data.user.id,email,client,token:''};accounts.push(entry);
  const login=await client.auth.signInWithPassword({email,password});requireSuccess(login);entry.token=login.data.session!.access_token;
 }
});
afterAll(async()=>{
 if(!admin)return;
 if(objects.length){const result=await admin.storage.from('velmory-private').remove(objects);requireSuccess(result)}
 for(const account of accounts){requireSuccess(await admin.auth.admin.deleteUser(account.id));await account.client.auth.signOut()}
 if(gateChanged)requireSuccess(await admin.from('service_settings').update({email_signup_enabled:originalGate}).eq('singleton',true));
});
async function media(who:number,action:string,id:string,method='GET',body?:BodyInit,part?:number){return fetch(`${url}/functions/v1/media?action=${action}&id=${id}${part===undefined?'':'&part='+part}`,{method,body,headers:{Authorization:'Bearer '+accounts[who].token,apikey:anon,'Content-Type':method==='PUT'?'application/octet-stream':'application/json'}})}
it('runs real Auth, PostgREST, encrypted Storage and scheduled-letter access together',async()=>{
 const [sender,recipient]=accounts;const a=await createVault('sender disposable vault passphrase',sender.id),b=await createVault('recipient disposable vault passphrase',recipient.id);
 for(const [account,vault]of [[sender,a],[recipient,b]] as const)requireSuccess(await account.client.from('vaults').insert({owner_id:account.id,envelope:vault.envelope,public_key:vault.envelope.publicKey}));
 requireSuccess(await sender.client.rpc('save_document',{p_id:'diary:test',p_expected_revision:0,p_envelope:await encrypt({title:'Private live test'},a.key,sender.id+':diary:test'),p_deleted:false}));
 const other=await recipient.client.from('documents').select('*');requireSuccess(other);expect(other.data).toHaveLength(0);
 requireSuccess(await sender.client.rpc('invite_contact',{p_email:recipient.email}));const invites=await recipient.client.rpc('list_contacts');requireSuccess(invites);requireSuccess(await recipient.client.rpc('accept_contact',{p_id:invites.data[0].invitation_id}));
 const id=crypto.randomUUID(),attachmentKey=await randomContentKey();const encrypted=new TextEncoder().encode(JSON.stringify(await encrypt({photo:'private image stand-in'},attachmentKey,sender.id+':media:'+id)));const hash=createHash('sha256').update(encrypted).digest('hex');
 expect((await media(0,'reserve',id,'POST',JSON.stringify({id,bytes:encrypted.length,sha256:hash,purpose:'letter'}))).status).toBe(200);
 objects.push(`${sender.id}/${id}/0`);
 expect((await media(0,'chunk',id,'PUT',encrypted,0)).status).toBe(200);expect((await media(0,'commit',id,'POST')).status).toBe(200);
 expect((await recipient.client.storage.from('velmory-private').download(objects[0])).error).not.toBeNull();
 const letterId=crypto.randomUUID(),sealed=await sealForRecipient({title:'Live test letter',attachment:{id,key:await encodeKey(attachmentKey)}},b.envelope.publicKey);
 requireSuccess(await sender.client.rpc('seal_letter_with_media',{p_id:letterId,p_recipient:recipient.id,p_opens_at:new Date(Date.now()+5000).toISOString(),p_timezone:'UTC',p_payload:sealed.payload,p_wrapped_key:sealed.wrappedKey,p_recipient_key:b.envelope.publicKey,p_media:[id]}));
 expect((await recipient.client.rpc('open_letter',{p_id:letterId})).error).not.toBeNull();expect((await media(1,'download',id)).status).not.toBe(200);
 await new Promise(resolve=>setTimeout(resolve,6000));
 const opened=await recipient.client.rpc('open_letter',{p_id:letterId});requireSuccess(opened);const letter=await openReceived<{title:string;attachment:{id:string;key:string}}>(opened.data.payload,opened.data.wrapped_key,b.key);expect(letter.title).toBe('Live test letter');
 const received=await media(1,'download',id);expect(received.status).toBe(200);const downloaded=new Uint8Array(await received.arrayBuffer());expect(downloaded).toEqual(encrypted);expect(await decrypt(JSON.parse(new TextDecoder().decode(downloaded)),await decodeKey(letter.attachment.key),sender.id+':media:'+id)).toEqual({photo:'private image stand-in'});
 requireSuccess(await sender.client.rpc('cancel_letter',{p_id:letterId}));expect((await media(1,'download',id)).status).not.toBe(200);
});
