import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('large collections stay bounded and the book controls remain separate',async({page})=>{
 test.setTimeout(240000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/auth/login');
 await page.getByRole('button',{name:'Open a private vault on this device'}).click();
 await page.getByLabel('Vault passphrase',{exact:true}).fill('a reading room test phrase');await page.getByLabel('Confirm passphrase').fill('a reading room test phrase');
 await page.getByRole('button',{name:'Create my private vault'}).click();await page.getByLabel('Confirm your recovery key').fill((await page.locator('.recovery-key').innerText()).replaceAll(' ',''));await page.getByRole('checkbox').check();await page.getByRole('button',{name:/enter my library/i}).click();
 // Synthetic memories live only in this browser test's isolated vault.
 await page.evaluate(async()=>{
  const dbPath='/src/core/db.ts',cryptoPath='/src/core/crypto.ts',repoPath='/src/core/repository.ts',typesPath='/src/core/types.ts';
  const {db}=await import(dbPath),{unlockVault,wipe}=await import(cryptoPath),{saveDocument}=await import(repoPath),{newDiary,newPage}=await import(typesPath);
  const vault=(await db.vaults.toArray())[0];const key=await unlockVault('a reading room test phrase',vault.owner,vault.envelope);
  const titles=['Small joys & ordinary magic','The places that made me','Letters from a slower summer','A thousand little beginnings','A life in photographs','The people I call home','When the world felt golden','Quiet mornings','Beyond the familiar','The way back','Things worth keeping','A very long diary title that should stay embossed inside the cover without touching the clasp or decorative frame'];
  try{for(let i=0;i<12;i++){const diary=newDiary(titles[i],['navy','forest','burgundy','charcoal','rose'][i%5]);diary.createdAt=new Date(2026,0,12-i).toISOString();diary.pages=Array.from({length:80},(_,j)=>({...newPage(),date:`${2015+j%12}-07-${String(j%28+1).padStart(2,'0')}`,title:j%3===0?'A quiet afternoon by the window':j%3===1?'The road that brought me here':'Little things, beautifully ordinary',place:j%2?'Galle':'Home',people:'Family',mood:'Grateful',bookmark:j%5===0,objects:[{id:crypto.randomUUID(),kind:'text',x:48,y:165,width:395,height:125,rotation:0,fontFamily:'Cormorant Garamond',fontSize:22,content:'<p>The light found its way through the window. For a moment, everything was still.</p><p>Some days do not need to be extraordinary to be worth remembering.</p>'},{id:crypto.randomUUID(),kind:'photo',x:95,y:350,width:290,height:200,rotation:-4,content:'/assets/memories.webp',label:'A little corner of the world.'}]}));await saveDocument(vault.owner,key,'diary:'+diary.id,diary)}
   for(let i=0;i<7;i++){const id=crypto.randomUUID();await saveDocument(vault.owner,key,'letter:'+id,{id,title:['For the person I am becoming','Open on a golden morning','A little courage for tomorrow'][i%3],body:'Synthetic browser test letter.',opensAt:'2027-03-10T09:50:00Z',timezone:'Asia/Colombo',recipientId:vault.owner,recipientName:'My future self',status:'sealed',createdAt:new Date().toISOString()})}
  }finally{await wipe(key)}
 });
 await page.reload();await page.getByLabel('Vault passphrase',{exact:true}).fill('a reading room test phrase');await page.getByRole('button',{name:'Unlock my diary'}).click();
 await expect(page.locator('.shelf-item')).toHaveCount(4);await expect(page.locator('.cover-title')).not.toContainText(['VELMORY']);
 await page.screenshot({path:'test-results/reading-room-library-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.shelf-item')).toHaveCount(4);await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.cover-title').last()).toContainText('A very long diary title');
 expect(await page.locator('.cover-title').last().evaluate(e=>{const a=e.getBoundingClientRect(),b=e.parentElement!.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&a.bottom<=b.bottom})).toBeTruthy();
 await page.getByRole('button',{name:'Previous',exact:true}).click();await page.getByRole('button',{name:'Previous',exact:true}).click();await page.getByRole('link',{name:'Open Small joys & ordinary magic',exact:true}).click();
 const top=await page.locator('.editor-top').boundingBox(),book=await page.locator('.book-spread').boundingBox(),footer=await page.locator('.editor-footer').boundingBox();
 expect(book!.y).toBeGreaterThan(top!.y+top!.height+8);expect(book!.y+book!.height).toBeLessThan(footer!.y-8);await expect(page.locator('.page-thumbnails button')).toHaveCount(5);
 await page.getByRole('button',{name:'Jump to page',exact:true}).click();await page.getByRole('option',{name:/^80 ·/}).click();await expect(page.locator('.editor-footer')).toContainText('Page 80 of 80');
 await page.getByRole('button',{name:'Previous page',exact:true}).click();await expect(page.locator('.editor-footer')).toContainText('Page 78 of 80');
 await page.screenshot({path:'test-results/reading-room-editor-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Memories',exact:true}).click();await expect(page.locator('.diary-group')).toHaveCount(1);await expect(page.locator('.memory-row')).toHaveCount(6);await expect(page.locator('.result-summary')).toContainText('960 memories');
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.collection-pager')).toContainText('7–12 of 80');await page.locator('.diary-switcher button').nth(1).click();await expect(page.locator('.group-heading h2')).toHaveText('The places that made me');
 for(const [link,shot] of [['Memories','memories'],['Search memories','search'],['Life timeline','timeline'],['Memory Time Machine','time-machine'],['On this day','calendar'],['Future letters','letters'],['Print & export','export'],['Privacy & settings','settings'],['My profile','profile'],['Reflection companion','companion']]){
  await page.getByRole('link',{name:link,exact:true}).click();if(link==='On this day')await page.getByLabel('Choose a day',{exact:true}).fill('2026-07-01');
  if(link==='Future letters'){await expect(page.locator('.letter-card')).toHaveCount(4);await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.letter-card')).toHaveCount(3)}
  if(link==='Privacy & settings'){for(const tab of ['Storage','Experience','Consent','Account','Vault & keys']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-pressed','true')}await expect(page.getByRole('heading',{name:'Your private vault',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Your storage',exact:true})).toBeHidden()}
  if(link==='My profile'){await page.getByRole('button',{name:'My books',exact:true}).click();await expect(page.locator('.profile-collection')).toBeVisible();await expect(page.locator('.profile-hero')).toBeHidden()}
  await page.screenshot({path:`test-results/reading-room-${shot}-desktop.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),link+' document grows').toBeTruthy();
  const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(scan.violations.filter(v=>v.impact==='critical'||v.impact==='serious'),link+' accessibility').toEqual([]);
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('link',{name:'Memories',exact:true}).click();await expect(page.locator('.memory-row')).toHaveCount(2);await expect(page.locator('.diary-group')).toHaveCount(1);await page.screenshot({path:'test-results/reading-room-memories-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('link',{name:'My library',exact:true}).click();await expect(page.locator('.shelf-item')).toHaveCount(2);await page.screenshot({path:'test-results/reading-room-library-mobile.png',fullPage:true});
 expect(errors).toEqual([]);
});
