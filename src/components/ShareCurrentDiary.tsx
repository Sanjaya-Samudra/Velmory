import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useSession} from '../core/Session';
import {flushWrites} from '../core/repository';
import {shareExistingDiary} from '../core/sharedDiary';
import type {Diary} from '../core/types';
export default function ShareCurrentDiary({diary,onChange}:{diary:Diary;onChange:(d:Diary)=>Promise<void>}){
 const {account,key}=useSession(),navigate=useNavigate();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const share=async()=>{if(!key)return;setBusy(true);setError('');try{await flushWrites();const id=await shareExistingDiary(diary,key);await onChange({...diary,sharedDiaryId:id});navigate('/app/shared-diaries')}catch(e){setError((e as Error).message)}finally{setBusy(false)}};
 return <><button className="button glass" onClick={()=>diary.sharedDiaryId?navigate('/app/shared-diaries'):setOpen(true)}>{diary.sharedDiaryId?'Manage sharing':'Share this diary'}</button>{open&&<div className="modal-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="share-current-title"><h2 id="share-current-title">Write the next chapter together.</h2><p>Create a shared working edition of “{diary.title}” with its current pages. Future collaboration happens in Shared diaries; your private original remains a snapshot. The shared title is visible to the service. Audio attachments and password-sealed pages cannot currently be converted.</p>{account?.local?<p>Sign in to a cloud account to share diaries.</p>:<p>After creating it, invite an accepted contact and use Manage access to choose Can view, Can edit, or remove access.</p>}{error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button className="button glass" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button className="button gold" disabled={busy||account?.local} onClick={()=>void share()}>{busy?'Preparing shared diary…':'Create shared edition'}</button></div></section></div>}</>;
}
