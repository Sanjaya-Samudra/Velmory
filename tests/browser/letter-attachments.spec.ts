import {test,expect} from '@playwright/test';

test('a local letter encrypts and restores an attachment',async({page})=>{
 test.setTimeout(120000);
 await page.goto('/auth/login');
 await page.getByRole('button',{name:'Open a private vault on this device'}).click();
 await page.getByLabel('Vault passphrase',{exact:true}).fill('letter attachment test phrase');
 await page.getByLabel('Confirm passphrase').fill('letter attachment test phrase');
 await page.getByRole('button',{name:'Create my private vault'}).click();
 await page.getByLabel('Confirm your recovery key').fill((await page.locator('.recovery-key').innerText()).replaceAll(' ',''));await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:/enter my library/i}).click();
 await page.getByRole('link',{name:'Future letters',exact:true}).click();
 await page.getByRole('button',{name:'Write a future letter'}).click();
 await page.getByLabel('Title',{exact:true}).fill('A letter with a keepsake');
 await page.getByLabel('Your letter').fill('Keep this little memory.');
 await page.getByLabel('Open on',{exact:true}).fill('2030-01-01T10:00');
 await page.getByLabel('Attachments (up to ten, 4 MB each)').setInputFiles({
  name:'keepsake.txt',mimeType:'text/plain',buffer:Buffer.from('The private keepsake inside the letter.'),
 });
 await page.getByRole('button',{name:'Seal my letter'}).click();
 await expect(page.getByText('A letter with a keepsake')).toBeVisible();
 await page.getByRole('button',{name:'View creator’s original'}).click();
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download keepsake.txt'}).click();
 const file=await download;
 expect(file.suggestedFilename()).toBe('keepsake.txt');
 const stored=await page.evaluate(async()=>new Promise<string>((resolve,reject)=>{
  const request=indexedDB.open('velmory-private-v1');
  request.onsuccess=()=>{
   const database=request.result, transaction=database.transaction(['records','uploads']);
   const requests=['records','uploads'].map(store=>transaction.objectStore(store).getAll());
   transaction.oncomplete=()=>resolve(JSON.stringify(requests.map(item=>item.result)));
   transaction.onerror=()=>reject(transaction.error);
  };
  request.onerror=()=>reject(request.error);
 }));
 expect(stored).not.toContain('The private keepsake inside the letter.');
 await page.reload();
 await page.getByLabel('Vault passphrase',{exact:true}).fill('letter attachment test phrase');
 await page.getByRole('button',{name:'Unlock my diary'}).click();
 await page.getByRole('link',{name:'Future letters',exact:true}).click();
 await page.getByRole('button',{name:'View creator’s original'}).click();
 await expect(page.getByRole('button',{name:'Download keepsake.txt'})).toBeVisible();
});
