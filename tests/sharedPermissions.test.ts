import {it,expect} from 'vitest';
import {createDatabase,reset,login,contacts,alice,bob,carol,cipher,publicKey} from './helpers/database';

it('enforces sharing permissions, removal and incremental updates on the server',async()=>{
 const db=await createDatabase();try{await reset(db);await contacts(db);await login(db,alice);
 const result=await db.query<{id:string}>('select public.create_shared_diary($1,$2,$3,$4) as id',['Existing diary','navy','K'.repeat(108),publicKey(alice)]);const id=result.rows[0].id;
 await db.query('select public.invite_shared_member($1,$2,$3,$4)',[id,bob,'K'.repeat(108),publicKey(bob)]);
 await db.query('select public.set_shared_member_role($1,$2,$3)',[id,bob,'viewer']);await login(db,bob);await db.query('select public.accept_shared_invite($1)',[id]);
 await expect(db.query('select public.save_shared_page($1,$2,0,$3,false)',[id,'page',cipher])).rejects.toThrow();
 await expect(db.query('select public.set_shared_member_role($1,$2,$3)',[id,bob,'editor'])).rejects.toThrow();
 await login(db,alice);await db.query('select public.save_shared_page($1,$2,0,$3,false)',[id,'page',cipher]);
 const first=await db.query<{data:{cursor:number}}>('select public.fetch_shared_pages($1) as data',[id]);
 await db.query('select public.set_shared_member_role($1,$2,$3)',[id,bob,'editor']);await login(db,bob);await db.query('select public.save_shared_page($1,$2,1,$3,false)',[id,'page',{...cipher,ciphertext:'D'.repeat(64)}]);
 const changes=await db.query<{data:{pages:unknown[]}}>('select public.fetch_shared_pages($1,$2) as data',[id,first.rows[0].data.cursor]);expect(changes.rows[0].data.pages).toHaveLength(1);
 await login(db,carol);await expect(db.query('select public.fetch_shared_pages($1)',[id])).rejects.toThrow();
 await login(db,alice);await db.query('select public.remove_shared_member($1,$2)',[id,bob]);await login(db,bob);await expect(db.query('select public.fetch_shared_pages($1)',[id])).rejects.toThrow();
 await expect(db.query('select public.save_shared_page($1,$2,2,$3,false)',[id,'page',cipher])).rejects.toThrow();
 }finally{await db.close()}
},60000);

it('allows direct lookup by email and auto-connects members into the community for Future Letters', async () => {
 const db = await createDatabase();
 try {
  await reset(db);
  // Alice and Carol start as strangers with NO prior contacts
  await login(db, alice);
  const lookup = await db.query<{lookup_user_for_sharing: any}>('select public.lookup_user_for_sharing($1)', ['carol@example.test']);
  expect(lookup.rows[0].lookup_user_for_sharing.found).toBe(true);
  expect(lookup.rows[0].lookup_user_for_sharing.id).toBe(carol);

  // Alice creates a shared diary and directly invites Carol
  const res = await db.query<{id:string}>('select public.create_shared_diary($1,$2,$3,$4) as id',['Direct Diary','navy','K'.repeat(108),publicKey(alice)]);
  const id = res.rows[0].id;
  await db.query('select public.invite_shared_member($1,$2,$3,$4)',[id, carol, 'K'.repeat(108), publicKey(carol)]);

  // Carol accepts the invitation
  await login(db, carol);
  await db.query('select public.accept_shared_invite($1)',[id]);

  // Both are now mutual accepted contacts in the community!
  const carolContacts = await db.query<{id:string;email:string;status:string}>('select * from public.list_contacts()');
  expect(carolContacts.rows.some(c => c.email === 'alice@example.test' && c.status === 'accepted')).toBe(true);

  await login(db, alice);
  const aliceContacts = await db.query<{id:string;email:string;status:string}>('select * from public.list_contacts()');
  expect(aliceContacts.rows.some(c => c.email === 'carol@example.test' && c.status === 'accepted')).toBe(true);
 } finally {
  await db.close();
 }
}, 60000);
