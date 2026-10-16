import {useEffect,useState,type FormEvent} from 'react';
import {backend,checkError} from '../core/backend';
import {Message} from '../components/Status';

export interface ServiceHealth {
 settings:{beta_accounts:number;default_quota:number;daily_email_limit:number};
 email_attempts_today:number;
 exhausted_jobs:number;
 overdue_jobs:number;
 deletions_pending:number;
 client_failures_24h:number;
 health:{name:string;last_run:string;status:'ok'|'error';code?:string}[];
 accounts:{id:string;used_bytes:number;quota_bytes:number;near_quota:boolean}[];
}
export default function AdminHealth({data,onChange}:{data:ServiceHealth;onChange:()=>Promise<void>}){
 const [limit,setLimit]=useState(data.settings.beta_accounts);
 const [quota,setQuota]=useState(Math.round(data.settings.default_quota/1048576));
 const [emails,setEmails]=useState(data.settings.daily_email_limit);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 useEffect(()=>{
  setLimit(data.settings.beta_accounts);
  setQuota(Math.round(data.settings.default_quota/1048576));
  setEmails(data.settings.daily_email_limit);
 },[data.settings.beta_accounts,data.settings.default_quota,data.settings.daily_email_limit]);
 const save=(event:FormEvent)=>{event.preventDefault();setBusy(true);setError('');setNotice('');
  void (async()=>{try{
   const result=await backend!.rpc('admin_settings',{p_accounts:limit,p_quota:quota*1048576,p_emails:emails});
   checkError(result.error);await onChange();setNotice('Service limits saved.');
  }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}})();
 };
 const near=data.accounts.filter(account=>account.near_quota).length;
 const remaining=Math.max(0,data.settings.daily_email_limit-data.email_attempts_today);
 return <section className="settings-card admin-health">
  <h2>Service health & limits</h2>
  <div className="profile-stats admin-stats">
   <span><b>{data.accounts.length}/{data.settings.beta_accounts}</b> Beta accounts</span>
   <span><b>{remaining}</b> Email attempts remaining today</span>
   <span><b>{near}</b> Accounts nearing quota</span>
   <span><b>{data.overdue_jobs}</b> Overdue jobs</span>
   <span><b>{data.client_failures_24h}</b> Client failures in 24h</span>
  </div>
  {(remaining<20||near>0||data.overdue_jobs>0||data.exhausted_jobs>0||data.deletions_pending>0||data.client_failures_24h>0)&&
   <Message error>{[
    remaining<20&&'Email budget is nearly exhausted.',
    near>0&&`${near} account(s) near storage allowance.`,
    data.overdue_jobs>0&&`${data.overdue_jobs} notification job(s) overdue.`,
    data.exhausted_jobs>0&&`${data.exhausted_jobs} job(s) exhausted retries.`,
    data.deletions_pending>0&&`${data.deletions_pending} account deletion(s) pending.`,
    data.client_failures_24h>0&&`${data.client_failures_24h} redacted client failure(s) in the last 24 hours.`,
   ].filter(Boolean).join(' ')}</Message>}
  {data.health.map(item=><p key={item.name} className="muted">
   {item.name}: {item.status} · last run {new Date(item.last_run).toLocaleString()}
   {item.code&&` · ${item.code}`}
  </p>)}
  <form onSubmit={save} className="admin-limits">
   <label>Beta account limit<input type="number" min="1" max="100000" required value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label>
   <label>Default allowance (MB)<input type="number" min="1" max="1024" required value={quota} onChange={e=>setQuota(Number(e.target.value))}/></label>
   <label>Daily notification email budget<input type="number" min="1" max="100000" required value={emails} onChange={e=>setEmails(Number(e.target.value))}/></label>
   <button className="button gold" disabled={busy}>{busy?'Saving…':'Save service limits'}</button>
  </form>
  {error&&<Message error>{error}</Message>}{notice&&<Message>{notice}</Message>}
 </section>;
}
