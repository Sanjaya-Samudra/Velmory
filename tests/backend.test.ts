import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase,reset,login,service,contacts,seal,alice,bob,carol,cipher,publicKey,vault} from './helpers/database';
let db:PGlite;beforeAll(async()=>{db=await createDatabase()},60000);beforeEach(async()=>reset(db));afterAll(async()=>db.close());
it('blocks direct Storage access even under a broad pre-existing policy',async()=>{await login(db,alice);await expect(db.query("insert into storage.objects(bucket_id,name)values('velmory-private','foreign/file')")).rejects.toThrow();await expect(db.query('truncate public.vaults cascade')).rejects.toThrow('permission');});
it('enforces email readiness and maintenance at the server',async()=>{await db.exec('update public.service_settings set email_signup_enabled=false');await expect(db.query('insert into auth.users values($1,$2)',[crypto.randomUUID(),'new@example.test'])).rejects.toThrow('Email signup');await db.exec('update public.service_settings set maintenance=true');await login(db,alice);await expect(db.query('select public.fetch_changes()')).rejects.toThrow('unavailable');await expect(db.query('select public.begin_account_deletion()')).rejects.toThrow('maintenance');});
it('publishes raster collections with an atomic audit and private draft assets',async()=>{await db.query("insert into public.user_roles values($1,'admin')",[alice]);await login(db,alice,'aal2');const asset=crypto.randomUUID();await db.query('select public.admin_register_artwork($1,$2,$3,$4)',[asset,'image/png',100,'a'.repeat(64)]);await db.query('select public.admin_save_content($1,$2,$3)',['covers',{title:'Diary covers',items:[{name:'Forest',asset_id:asset}]},'cover']);await db.exec('reset role');const content=(await db.query<any>('select id from public.public_content')).rows[0].id;expect((await db.query("select * from public.admin_audit where action='artwork_upload'")).rows).toHaveLength(1);await db.exec("select set_config('test.uid','',false);select set_config('test.aal','aal1',false);set role anon");expect((await db.query<any>('select public.asset_access($1)',[asset])).rows[0].asset_access).toBeNull();await login(db,alice,'aal2');await db.query('select public.admin_publish_content($1)',[content]);await db.exec("reset role;select set_config('test.uid','',false);select set_config('test.aal','aal1',false);set role anon");expect((await db.query<any>('select public.asset_access($1)',[asset])).rows[0].asset_access.id).toBe(asset);});
const sha='a'.repeat(64);
it('only lets the sender delete a cancelled letter and queues its media for cleanup',async()=>{
 await contacts(db);const media=await upload();const letter=await seal(db,undefined,[media]);
 await login(db,alice);await expect(db.query('select public.delete_cancelled_letter($1)',[letter])).rejects.toThrow('cancelled');
 await db.query('select public.cancel_letter($1)',[letter]);
 await login(db,bob);await expect(db.query('select public.delete_cancelled_letter($1)',[letter])).rejects.toThrow('sender');
 await login(db,alice);await db.query('select public.delete_cancelled_letter($1)',[letter]);
 expect((await db.query('select id from public.letters where id=$1',[letter])).rows).toHaveLength(0);
 expect((await db.query<any>('select state,letter_id from public.media_objects where id=$1',[media])).rows[0]).toMatchObject({state:'deleting',letter_id:null});
});
async function upload(purpose='letter',size=100){await login(db,alice);const id=crypto.randomUUID();await db.query('select public.reserve_media($1,$2,$3,$4)',[id,size,sha,purpose]);await service(db);await db.query('select public.record_media_chunk($1,$2,$3,$4,$5)',[alice,id,0,size,sha]);await db.query('select public.commit_media($1,$2,$3)',[alice,id,sha]);return id}
it('paginates changes, retains tombstones, and rejects stale concurrent writes',async()=>{
 await login(db,alice);for(let i=0;i<3;i++)await db.query('select public.save_document($1,0,$2,false)',['diary:'+i,cipher]);
 const first=(await db.query<any>('select public.fetch_changes(0,2)')).rows[0].fetch_changes;expect(first.records).toHaveLength(2);expect(first.has_more).toBe(true);
 await db.query('select public.save_document($1,1,$2,true)',['diary:0',cipher]);
 const second=(await db.query<any>('select public.fetch_changes($1,2)',[first.cursor])).rows[0].fetch_changes;expect(second.records.map((r:any)=>r.id)).toEqual(['diary:2','diary:0']);expect(second.records[1].deleted).toBe(true);
 await expect(db.query('select public.save_document($1,null,$2,false)',['diary:0',cipher])).rejects.toThrow();
 const writes=await Promise.allSettled([db.query('select public.save_document($1,1,$2,false)',['diary:1',{...cipher,ciphertext:'X'.repeat(64)}]),db.query('select public.save_document($1,1,$2,false)',['diary:1',{...cipher,ciphertext:'Y'.repeat(64)}])]);expect(writes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 await login(db,bob);expect((await db.query<any>('select public.fetch_changes()')).rows[0].fetch_changes.records).toHaveLength(0);
});
it('counts reserved bytes, resumes idempotently, and restricts commit to the service',async()=>{
 await db.query('update public.profiles set quota_bytes=1048576 where id=$1',[alice]);await login(db,alice);const id=crypto.randomUUID();
 await db.query('select public.reserve_media($1,800000,$2,$3)',[id,sha,'diary']);await db.query('select public.reserve_media($1,800000,$2,$3)',[id,sha,'diary']);
 await expect(db.query('select public.reserve_media($1,300000,$2,$3)',[crypto.randomUUID(),sha,'diary'])).rejects.toThrow('Storage allowance');
 await expect(db.query('select public.reserve_media($1,700000,$2,$3)',[id,sha,'diary'])).rejects.toThrow('unavailable');
 await login(db,bob);await expect(db.query('select public.media_access($1)',[id])).rejects.toThrow('unavailable');await expect(db.query('select public.record_media_chunk($1,$2,0,524288,$3)',[alice,id,sha])).rejects.toThrow('permission');
 await service(db);await expect(db.query('select public.commit_media($1,$2,$3)',[alice,id,sha])).rejects.toThrow('Incomplete');
 await db.query('select public.record_media_chunk($1,$2,0,524288,$3)',[alice,id,sha]);await db.query('select public.record_media_chunk($1,$2,1,275712,$3)',[alice,id,sha]);
 await expect(db.query('select public.record_media_chunk($1,$2,0,524288,$3)',[alice,id,'b'.repeat(64)])).rejects.toThrow('conflict');await db.query('select public.commit_media($1,$2,$3)',[alice,id,sha]);
});
it('denies attachment access before release, after cancellation, and to other accounts',async()=>{
 await contacts(db);const media=await upload();const letter=await seal(db,undefined,[media]);await login(db,bob);await expect(db.query('select public.media_access($1)',[media])).rejects.toThrow('unavailable');
 await db.exec('reset role');await db.query("update public.letters set opens_at=now()-interval '1 second' where id=$1",[letter]);await login(db,bob);expect((await db.query<any>('select public.media_access($1)',[media])).rows[0].media_access.id).toBe(media);
 await login(db,carol);await expect(db.query('select public.media_access($1)',[media])).rejects.toThrow('unavailable');await login(db,alice);await expect(db.query('select public.delete_media($1)',[media])).rejects.toThrow('Cancel');await db.query('select public.cancel_letter($1)',[letter]);await login(db,bob);await expect(db.query('select public.media_access($1)',[media])).rejects.toThrow('unavailable');
});
it('rejects diary attachments, changed recipient keys, and null schedules',async()=>{
 await contacts(db);const media=await upload('diary');await expect(seal(db,undefined,[media])).rejects.toThrow('separately encrypted');
 await expect(db.query('select public.seal_letter($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),bob,new Date(Date.now()+86400000).toISOString(),'UTC',cipher,'K'.repeat(108),publicKey(carol)])).rejects.toThrow('key changed');await expect(db.query('select public.seal_letter($1,$2,null,$3,$4,$5,$6)',[crypto.randomUUID(),bob,'UTC',cipher,'K'.repeat(108),publicKey(bob)])).rejects.toThrow();
});
it('deduplicates sealing, releases without email, and ignores cancelled claims',async()=>{
 await contacts(db);const letter=await seal(db,undefined,[],12);await db.exec('reset role');const before=(await db.query<any>('select * from public.letters where id=$1',[letter])).rows[0];await login(db,alice);await db.query('select public.seal_letter($1,$2,$3,$4,$5,$6,$7)',[letter,bob,before.opens_at,'Asia/Colombo',cipher,'K'.repeat(108),publicKey(bob)]);
 await db.exec('reset role');expect((await db.query('select * from public.notification_jobs')).rows).toHaveLength(1);await db.exec("update public.letters set opens_at=now()-interval '1 second';update public.notification_jobs set due_at=now(),scheduled_for=now();");await service(db);
 const jobs=(await db.query<any>('select public.claim_notification_jobs()')).rows[0].claim_notification_jobs;expect(jobs).toHaveLength(1);expect((await db.query("select * from public.letters where status='released'")).rows).toHaveLength(1);expect((await db.query('select * from public.notifications')).rows).toHaveLength(1);
 await login(db,alice);await db.query('select public.cancel_letter($1)',[letter]);await service(db);await db.query('select public.finish_notification($1,$2,$3)',[jobs[0].id,jobs[0].token,'sent']);expect((await db.query<any>('select status from public.notification_jobs')).rows[0].status).toBe('cancelled');
});
it('enforces lease tokens, bounded retries, and daily email budgets',async()=>{
 await contacts(db);await seal(db);await db.exec("reset role;update public.notification_jobs set due_at=now();update public.service_settings set daily_email_limit=1;");await service(db);
 const first=(await db.query<any>('select public.claim_notification_jobs()')).rows[0].claim_notification_jobs;expect(first).toHaveLength(1);expect((await db.query<any>('select public.claim_notification_jobs()')).rows[0].claim_notification_jobs).toHaveLength(0);
 await db.exec("update public.notification_jobs set locked_at=now()-interval '11 minutes' where status='processing';update public.service_settings set daily_email_limit=10;");const next=(await db.query<any>('select public.claim_notification_jobs()')).rows[0].claim_notification_jobs;const retry=next.find((j:any)=>j.id===first[0].id);expect(retry.token).not.toBe(first[0].token);
 await db.query('select public.finish_notification($1,$2,$3)',[first[0].id,first[0].token,'sent']);expect((await db.query<any>('select status from public.notification_jobs where id=$1',[retry.id])).rows[0].status).toBe('processing');await db.query('select public.finish_notification($1,$2,$3)',[retry.id,retry.token,'provider_rejected']);expect((await db.query<any>('select last_error from public.notification_jobs where id=$1',[retry.id])).rows[0].last_error).toBe('provider_rejected');
});
it('limits nonexistent contact lookups without exposing member existence',async()=>{await login(db,alice);for(let i=0;i<10;i++)await db.query('select public.invite_contact($1)',[`missing${i}@example.test`]);await expect(db.query('select public.invite_contact($1)',['bob@example.test'])).rejects.toThrow('limit');expect((await db.query('select * from public.list_contacts()')).rows).toHaveLength(0)});
it('rewraps keys with revision checks without changing recipient identity',async()=>{await login(db,alice);const v=vault(alice);await db.query('select public.rewrap_vault(1,$1)',[{...v,pass:{...cipher,ciphertext:'X'.repeat(64)}}]);await expect(db.query('select public.rewrap_vault(1,$1)',[v])).rejects.toThrow('revision_conflict');await expect(db.query('select public.rewrap_vault(2,$1)',[{...v,publicKey:publicKey(bob)}])).rejects.toThrow('Invalid');});
it('keeps drafts private, validates content, and rolls back published revisions',async()=>{
 await db.query("insert into public.user_roles values($1,'admin')",[alice]);await login(db,alice,'aal2');await expect(db.query('select public.admin_save_content($1,$2,$3)',['hello',{text:'Hello',script:'alert(1)'},'announcement'])).rejects.toThrow('Invalid');for(const text of ['First','Second'])await db.query('select public.admin_save_content($1,$2,$3)',['hello',{text},'announcement']);expect((await db.query('select * from public.public_content')).rows).toHaveLength(0);
 await db.exec('reset role');const rows=(await db.query<any>('select * from public.public_content order by revision')).rows;await login(db,alice,'aal2');await db.query('select public.admin_publish_content($1)',[rows[1].id]);await db.query('select public.admin_publish_content($1)',[rows[0].id]);await db.exec("reset role;select set_config('test.uid','',false);select set_config('test.aal','aal1',false);set role anon");expect((await db.query<any>('select body from public.public_content')).rows).toEqual([{body:{text:'First'}}]);
});
it('disables private operations during durable account deletion',async()=>{
 await contacts(db);const media=await upload();const letter=await seal(db,undefined,[media]);await login(db,alice);await db.query('select public.begin_account_deletion()');await expect(db.query('select public.fetch_changes()')).rejects.toThrow('unavailable');await expect(db.query('select public.reserve_media($1,100,$2,$3)',[crypto.randomUUID(),sha,'diary'])).rejects.toThrow('unavailable');await login(db,bob);await expect(db.query('select public.open_letter($1)',[letter])).rejects.toThrow('not available');await service(db);expect((await db.query('select * from public.account_deletions')).rows).toHaveLength(1);expect((await db.query<any>('select state from public.media_objects')).rows[0].state).toBe('deleting');
});
it('restores records and access policies from a local database backup',async()=>{
 await login(db,alice);await db.query('select public.save_document($1,0,$2,false)',['diary:restore',cipher]);await db.exec('reset role');const archive=await db.dumpDataDir();const restored=new PGlite({loadDataDir:archive});try{await login(restored,alice);expect((await restored.query('select * from public.documents')).rows).toHaveLength(1);await login(restored,bob);expect((await restored.query('select * from public.documents')).rows).toHaveLength(0)}finally{await restored.close()}
},30000);
it('secures collaborative shared diaries with member-only access and revision tracking',async()=>{
 await contacts(db);
 await login(db,alice);
 const diaryId=(await db.query<any>('select public.create_shared_diary($1,$2,$3,$4,$5,$6)',['Our Love Story','rose','W'.repeat(80),publicKey(alice),'2024-02-14','Anniversary'])).rows[0].create_shared_diary;
 expect(diaryId).toBeDefined();

 // Alice invites Bob (accepted contact)
 await db.query('select public.invite_shared_member($1,$2,$3,$4)',[diaryId,bob,'W'.repeat(80),publicKey(bob)]);

 // Alice cannot invite Carol (not an accepted contact)
 await expect(db.query('select public.invite_shared_member($1,$2,$3,$4)',[diaryId,carol,'W'.repeat(80),publicKey(carol)])).rejects.toThrow('accepted contact');

 // Carol cannot view or list Alice's shared diary
 await login(db,carol);
 const carolDiaries=(await db.query<any>('select public.list_shared_diaries()')).rows[0].list_shared_diaries;
 expect(carolDiaries.some((d:any)=>d.id===diaryId)).toBe(false);
 await expect(db.query('select public.save_shared_page($1,$2,0,$3,false)',[diaryId,'page-1',cipher])).rejects.toThrow('Not a member');

 // Bob sees pending invitation and accepts
 await login(db,bob);
 const bobDiaries=(await db.query<any>('select public.list_shared_diaries()')).rows[0].list_shared_diaries;
 const invite=bobDiaries.find((d:any)=>d.id===diaryId);
 expect(invite).toMatchObject({title:'Our Love Story',status:'pending',my_role:'editor'});
 await db.query('select public.accept_shared_invite($1)',[diaryId]);

 // Bob saves a collaborative page
 const rev=(await db.query<any>('select public.save_shared_page($1,$2,0,$3,false)',[diaryId,'page-1',cipher])).rows[0].save_shared_page;
 expect(Number(rev)).toBe(1);

 // Alice syncs and retrieves the shared page
 await login(db,alice);
 const pages=(await db.query<any>('select public.fetch_shared_pages($1,0,10)',[diaryId])).rows[0].fetch_shared_pages;
 expect(pages.pages).toHaveLength(1);
 expect(pages.pages[0]).toMatchObject({page_id:'page-1',author_id:bob,revision:1});

 // Stale concurrent write by Alice with differing ciphertext is rejected with revision conflict
 await expect(db.query('select public.save_shared_page($1,$2,0,$3,false)',[diaryId,'page-1',{...cipher,ciphertext:'Z'.repeat(64)}])).rejects.toThrow('revision_conflict');

 // Updating milestone
 await db.query('select public.update_shared_diary_milestone($1,$2,$3)',[diaryId,'2024-02-14','Two years together']);
 const updatedList=(await db.query<any>('select public.list_shared_diaries()')).rows[0].list_shared_diaries;
 expect(updatedList.find((d:any)=>d.id===diaryId).milestone_label).toBe('Two years together');

 // Alice deletes the shared diary, cleanly removing it for all members
 await db.query('select public.delete_shared_diary($1)',[diaryId]);
 expect((await db.query('select id from public.shared_diaries where id=$1',[diaryId])).rows).toHaveLength(0);
 expect((await db.query('select id from public.shared_diary_pages where diary_id=$1',[diaryId])).rows).toHaveLength(0);
});
