export type Cover='navy'|'forest'|'burgundy'|'charcoal'|'rose';
export interface PageObject {id:string;kind:'text'|'photo'|'sticker'|'audio'|'drawing';x:number;y:number;width:number;height:number;rotation:number;content:string;label?:string;points?:number[][];color?:string;fontFamily?:string;fontSize?:number;textAlign?:'left'|'center'|'right';audio?:{v?:2;key:string;mime:string;name:string;size:number;parts:import('./media').MediaReference[]}}
export interface PageSeal {v:1;salt:string;ops:number;mem:number;payload:CipherEnvelope}
export interface DiaryPage {id:string;date:string;title:string;objects:PageObject[];bookmark:boolean;tags:string;place:string;people:string;mood?:string;chapter?:string;seal?:PageSeal;timeCapsuleDate?:string;authorName?:string}
export interface Diary {id:string;title:string;cover:Cover;coverArt?:string;createdAt:string;archived:boolean;pages:DiaryPage[]}
export interface CipherEnvelope {v:1;nonce:string;ciphertext:string}
export interface VaultEnvelope {v:1;salt:string;ops:number;mem:number;pass:CipherEnvelope;recovery:CipherEnvelope;publicKey:string}
export interface EncryptedRecord {id:string;owner:string;envelope:CipherEnvelope;revision:number;pending:boolean;updatedAt:string;deleted?:boolean}
export interface LocalLetter {id:string;title:string;body:string;opensAt:string;timezone:string;recipientId:string;recipientName:string;status:'prepared'|'sealed'|'cancelled'|'released';createdAt:string;opened?:boolean;attachments?:import('./service').LetterAttachment[];delivery?:import('./service').PreparedDelivery}
export const newPage=():DiaryPage=>({id:crypto.randomUUID(),date:new Date().toISOString().slice(0,10),title:'A day to remember',objects:[],bookmark:false,tags:'',place:'',people:''});
export const newDiary=(title:string,cover:Cover):Diary=>({id:crypto.randomUUID(),title,cover,createdAt:new Date().toISOString(),archived:false,pages:[newPage()]});
