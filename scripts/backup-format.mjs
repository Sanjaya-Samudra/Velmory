import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,appendFile,stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
const magic=Buffer.from('VELMORY1');
export function backupKey(value=process.env.VELMORY_BACKUP_KEY){if(!value||!/^[a-f0-9]{64}$/i.test(value))throw Error('Supply VELMORY_BACKUP_KEY as 64 hex characters and retain it separately.');return Buffer.from(value,'hex')}
export function encryptBuffer(data,key){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(magic);return Buffer.concat([magic,nonce,cipher.update(data),cipher.final(),cipher.getAuthTag()])}
export function decryptBuffer(data,key){if(data.length<36||!data.subarray(0,8).equals(magic))throw Error('Invalid backup format');const decipher=createDecipheriv('aes-256-gcm',key,data.subarray(8,20));decipher.setAAD(magic);decipher.setAuthTag(data.subarray(-16));return Buffer.concat([decipher.update(data.subarray(20,-16)),decipher.final()])}
export async function encryptStream(input,path,key){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),output=createWriteStream(path,{flags:'wx',mode:0o600});cipher.setAAD(magic);output.write(Buffer.concat([magic,nonce]));await pipeline(input,cipher,output);await appendFile(path,cipher.getAuthTag())}
export async function decryptFile(source,target,key){const size=(await stat(source)).size;if(size<36)throw Error('Invalid backup format');const file=await import('node:fs/promises').then(fs=>fs.open(source,'r'));try{const header=Buffer.alloc(20),tag=Buffer.alloc(16);await file.read(header,0,20,0);await file.read(tag,0,16,size-16);if(!header.subarray(0,8).equals(magic))throw Error('Invalid backup format');const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));decipher.setAAD(magic);decipher.setAuthTag(tag);await pipeline(createReadStream(source,{start:20,end:size-17}),decipher,createWriteStream(target,{flags:'wx',mode:0o600}))}finally{await file.close()}}
export async function fileHash(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex')}
export const digest=data=>createHash('sha256').update(data).digest('hex');
