import {encodeKey,randomContentKey,wipe} from './crypto';
import {stagePrivateMedia} from './media';
import type {LetterAttachment} from './service';

export const MAX_LETTER_FILE=4*1024*1024;
export function validateLetterFiles(files:File[]){
 if(files.length>10||files.some(file=>!file.size||file.size>MAX_LETTER_FILE))
  throw new Error('Attach up to ten files, each under 4 MB.');
}
export async function encodeLetterFile(file:File){
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {name:file.name,mime:file.type||'application/octet-stream',data:btoa(binary)};
}
export async function stageLocalLetterFiles(owner:string,files:File[]):Promise<LetterAttachment[]>{
 const attachments:LetterAttachment[]=[];
 for(const file of files){
  const key=await randomContentKey();
  try{
   const reference=await stagePrivateMedia(owner,key,await encodeLetterFile(file),'letter');
   attachments.push({reference,key:await encodeKey(key),name:file.name});
  }finally{await wipe(key)}
 }
 return attachments;
}
