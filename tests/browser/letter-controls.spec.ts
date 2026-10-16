import {test,expect} from '@playwright/test';

test('letter filters align and a revoked letter can be deleted',async({page})=>{
 await page.goto('/auth/login');
 await page.getByRole('button',{name:'Open a private vault on this device'}).click();
 await page.getByLabel('Vault passphrase',{exact:true}).fill('letter deletion test phrase');
 await page.getByLabel('Confirm passphrase').fill('letter deletion test phrase');
 await page.getByRole('button',{name:'Create my private vault'}).click();
 await page.getByLabel('Confirm your recovery key').fill((await page.locator('.recovery-key').innerText()).replaceAll(' ',''));await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:/enter my library/i}).click();
 await page.getByRole('link',{name:'Future letters',exact:true}).click();
 for(const width of [1024,1440]){
  await page.setViewportSize({width,height:900});
  const tops=await page.locator('.letter-filters input,.letter-filters .select-trigger').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().top));
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThan(2);
 }
 await page.getByRole('button',{name:'Write a future letter'}).click();
 await page.getByLabel('Title',{exact:true}).fill('A letter to remove');
 await page.getByLabel('Your letter').fill('A private draft for another day.');
 await page.getByLabel('Open on',{exact:true}).fill('2030-01-01T10:00');
 await page.getByRole('button',{name:'Seal my letter'}).click();
 await expect(page.getByText('A letter to remove')).toBeVisible();
 await page.getByRole('button',{name:'Revoke delivery'}).click();
 await expect(page.getByRole('dialog',{name:'Revoke this delivery?'})).toBeVisible();
 await page.getByRole('dialog',{name:'Revoke this delivery?'}).getByRole('button',{name:'Revoke delivery'}).click();
 await expect(page.getByRole('button',{name:'Delete letter'})).toBeVisible();
 await page.getByRole('button',{name:'Delete letter'}).click();
 await expect(page.getByRole('dialog',{name:'Delete this revoked letter?'})).toBeVisible();
 await page.getByRole('dialog',{name:'Delete this revoked letter?'}).getByRole('button',{name:'Delete letter'}).click();
 await expect(page.getByText('A letter to remove')).toHaveCount(0);
 await page.reload();
 await page.getByLabel('Vault passphrase',{exact:true}).fill('letter deletion test phrase');
 await page.getByRole('button',{name:'Unlock my diary'}).click();
 await page.getByRole('link',{name:'Future letters',exact:true}).click();
 await expect(page.getByText('A letter to remove')).toHaveCount(0);
});
