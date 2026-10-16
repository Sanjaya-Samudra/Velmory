import {backend,checkError} from './backend';
import {db} from './db';
import {rewrapVault,randomContentKey,encodeKey,decodeKey,sealForRecipient,openReceived,wipe} from './crypto';
import {stagePrivateMedia,synchronizeMedia,readPrivateMedia,type MediaReference} from './media';
import {saveDocument} from './repository';
import type {CipherEnvelope} from './types';
export async function rpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{if(!backend)throw new Error('Cloud service is not configured.');const {data,error}=await backend.rpc(name,args);checkError(error);return data as T}
export async function changeVaultPassphrase(owner:string,key:Uint8Array,passphrase:string){
 const next=await rewrapVault(key,passphrase,owner);
 if(owner.startsWith('device:'))await db.vaults.put({owner,envelope:next.envelope});
 else{if(!backend)throw new Error('Cloud service is not configured.');const {data,error}=await backend.from('vaults').select('revision').eq('owner_id',owner).single();checkError(error);const revision=await rpc<number>('rewrap_vault',{p_expected_revision:data!.revision,p_envelope:next.envelope});await db.vaults.put({owner,envelope:next.envelope,revision})}
 return next; // caller must show and confirm the replacement recovery key
}
export interface LetterAttachment {reference:MediaReference;key:string;name:string}
export interface LetterContent {title:string;body:string;attachments:LetterAttachment[]}
export interface PreparedDelivery {id:string;recipient:string;publicKey:string;opensAt:string;timezone:string;payload:CipherEnvelope;wrappedKey:string;media:string[]}
export async function prepareDelivery(owner:string,vaultKey:Uint8Array,recipient:string,opensAt:string,timezone:string,title:string,body:string,files:{name:string;mime:string;data:string}[]=[]):Promise<PreparedDelivery>{
 if(files.length>10)throw new Error('Use no more than ten attachments.');
 if(!Number.isFinite(Date.parse(opensAt))||Date.parse(opensAt)<=Date.now())throw new Error('Choose a future opening time.');
 const resolved=await rpc<{public_key:string}>('resolve_recipient',{p_id:recipient});
 const attachments:LetterAttachment[]=[];
 for(const file of files){const key=await randomContentKey();try{const reference=await stagePrivateMedia(owner,key,{mime:file.mime,data:file.data},'letter');attachments.push({reference,key:await encodeKey(key),name:file.name})}finally{await wipe(key)}}
 const id=crypto.randomUUID(),content={title,body,attachments},sealed=await sealForRecipient(content,resolved.public_key);
 const delivery={id,recipient,publicKey:resolved.public_key,opensAt,timezone,payload:sealed.payload,wrappedKey:sealed.wrappedKey,media:attachments.map(a=>a.reference.id)};
 // Persist the immutable retry request and sender original under the sender key.
 await saveDocument(owner,vaultKey,'letter:'+id,{id,title,body,attachments,delivery,status:'prepared',opensAt,timezone,recipientId:recipient,createdAt:new Date().toISOString()});return delivery;
}
export async function submitDelivery(owner:string,delivery:PreparedDelivery){
 for(const id of delivery.media)await synchronizeMedia(owner,id);
 await rpc('seal_letter_with_media',{p_id:delivery.id,p_recipient:delivery.recipient,p_opens_at:delivery.opensAt,p_timezone:delivery.timezone,p_payload:delivery.payload,p_wrapped_key:delivery.wrappedKey,p_recipient_key:delivery.publicKey,p_media:delivery.media});
}
export async function receiveDelivery(id:string,vaultKey:Uint8Array){const data=await rpc<{payload:CipherEnvelope;wrapped_key:string}>('open_letter',{p_id:id});return openReceived<LetterContent>(data.payload,data.wrapped_key,vaultKey)}
export async function readLetterAttachment(attachment:LetterAttachment){const key=await decodeKey(attachment.key);try{return await readPrivateMedia<{mime:string;data:string}>(attachment.reference,key)}finally{await wipe(key)}}
export const serviceUsage=()=>rpc<{used_bytes:number;quota_bytes:number;warning:boolean}>('storage_usage');
export const markNotificationRead=(id:string)=>rpc('mark_notification_read',{p_id:id});
export const reportOperationalEvent=(area:'sync'|'media'|'archive'|'ui',code:string,duration?:number)=>rpc('report_operational_event',{p_area:area,p_code:code,p_duration:duration??null});
