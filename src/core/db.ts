import Dexie,{type EntityTable,type Table} from 'dexie';
import type {EncryptedRecord,VaultEnvelope} from './types';
export interface UploadRecord {owner:string;id:string;bytes:Uint8Array;sha256:string;purpose:'diary'|'letter';state:'pending'|'ready'|'deleting'}
export function createDatabase(name='velmory-private-v1'){const db=new Dexie(name) as Dexie & {
 vaults:EntityTable<{owner:string;envelope:VaultEnvelope;revision?:number},'owner'>;
 records:Table<EncryptedRecord,[string,string]>;
 cursors:EntityTable<{owner:string;value:number},'owner'>;
 uploads:Table<UploadRecord,[string,string]>;
};
db.version(1).stores({vaults:'owner',documents:'id,owner,updatedAt'});
db.version(2).stores({vaults:'owner',documents:'id,owner,updatedAt',records:'[owner+id],owner,updatedAt',cursors:'owner',uploads:'[owner+id],owner,state'}).upgrade(async tx=>{
 const rows=await tx.table('documents').toArray();if(rows.length)await tx.table('records').bulkPut(rows);await tx.table('documents').clear();
});
db.version(3).stores({documents:null});return db;}
export const db=createDatabase();
export async function clearDevice(owner:string){await db.transaction('rw',db.vaults,db.records,db.cursors,db.uploads,async()=>{await db.records.where('owner').equals(owner).delete();await db.uploads.where('owner').equals(owner).delete();await db.vaults.delete(owner);await db.cursors.delete(owner)})}
