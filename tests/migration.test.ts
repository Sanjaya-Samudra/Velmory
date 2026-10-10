import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import {it,expect} from 'vitest';
import {createDatabase} from '../src/core/db';
it('migrates the original encrypted device database without losing a diary',async()=>{
 const name='velmory-migration-'+crypto.randomUUID(),old=new Dexie(name);old.version(1).stores({vaults:'owner',documents:'id,owner,updatedAt'});
 const record={id:'diary:legacy',owner:'device:original',envelope:{v:1,nonce:'nonce',ciphertext:'legacy-encrypted-bytes'},revision:0,pending:true,updatedAt:new Date().toISOString()};await old.table('documents').put(record);old.close();
 const upgraded=createDatabase(name);try{await upgraded.open();expect(await upgraded.records.get([record.owner,record.id])).toEqual(record);expect(upgraded.tables.some(t=>t.name==='documents')).toBe(false)}finally{await upgraded.delete()}
});
