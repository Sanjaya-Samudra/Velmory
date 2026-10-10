import {test,expect} from '@playwright/test';

test.skip(!process.env.VELMORY_OFFLINE_TEST,'Production preview only');
test('the production app shell opens after a cold offline launch',async({page,context})=>{
 await page.goto('/');
 await page.evaluate(async()=>{
  await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)
   await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
 });
 await context.setOffline(true);
 await page.goto('/features');
 await expect(page.getByRole('heading',{level:1})).toBeVisible();
 await page.goto('/privacy');
 await expect(page.getByRole('heading',{level:1})).toBeVisible();
});
