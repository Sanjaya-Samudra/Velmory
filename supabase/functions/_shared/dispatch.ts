import {checked,clients,endpoint,schedulerAuthorized,type Runtime} from './http.ts';
export function dispatchHandler(runtime:Runtime){return endpoint(runtime,async req=>{
 schedulerAuthorized(req,runtime);const {admin}=clients(runtime,req);if(checked(await admin.from('service_settings').select('maintenance').eq('singleton',true).single())?.maintenance)return Response.json({maintenance:true},{status:503});
 checked(await admin.rpc('release_due_letters'));
 const resendKey=runtime.env('RESEND_API_KEY'),brevoKey=runtime.env('BREVO_API_KEY');
 const apiKey=resendKey||brevoKey,from=runtime.env('MAIL_FROM'),appUrl=runtime.env('APP_URL');
 if(!apiKey||!from||!appUrl){await admin.from('service_health').upsert({name:'letter-dispatch',last_run:new Date().toISOString(),status:'error',code:'email_configuration'});return Response.json({released:true,email:'not_configured'},{status:503})}
 const jobs=checked(await admin.rpc('claim_notification_jobs')) as {id:string;token:string}[];let sent=0,failed=0;
 for(let offset=0;offset<jobs.length;offset+=4){await Promise.all(jobs.slice(offset,offset+4).map(async job=>{
  const current=checked(await admin.rpc('prepare_notification',{p_id:job.id,p_token:job.token})) as {email:string;enabled:boolean;kind:string}|null;
  let outcome='cancelled';
  if(current&&!current.enabled)outcome='disabled';
  else if(current){try{
   const subject=current.kind==='reminder'?'A letter is waiting for tomorrow':'A letter is ready for you';
   const textContent=`${current.kind==='reminder'?'A private letter is scheduled to open in about 24 hours.':'A private letter is now ready to open.'}\n\nSign in to your Velmory letterbox: ${appUrl}/app/letters\n\nYour letter content is never included in email.`;
   const response=resendKey
    ? await runtime.fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({from:from.includes('<')?from:`Velmory <${from}>`,to:[current.email],subject,text:textContent})})
    : await runtime.fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'api-key':brevoKey!,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:'Velmory'},to:[{email:current.email}],subject,textContent,headers:{idempotencyKey:job.id}})});
   outcome=response.ok?'sent':'provider_rejected';await response.body?.cancel();
  }catch{outcome='provider_timeout'}}
  checked(await admin.rpc('finish_notification',{p_id:job.id,p_token:job.token,p_result:outcome}));
  if(outcome==='sent')sent++;if(outcome.startsWith('provider_'))failed++;
 }));}
 checked(await admin.from('service_health').upsert({name:'letter-dispatch',last_run:new Date().toISOString(),status:failed?'error':'ok',code:failed?'email_delivery':null}));
 return Response.json({processed:jobs.length,sent,failed});
})}
