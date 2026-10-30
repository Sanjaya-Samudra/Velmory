import {useCallback,useEffect,useState} from 'react';
import {Bell,Check,Mail,X} from 'lucide-react';
import {backend,checkError} from '../core/backend';
import {markNotificationRead} from '../core/service';
import {useSession} from '../core/Session';
import {Loading,Message} from '../components/Status';
type Notice={id:string;kind:string;letter_id:string|null;created_at:string;read_at:string|null};
export default function Notifications(){
  const {account}=useSession();
  const [items,setItems]=useState<Notice[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    if(!backend||account?.local){setLoading(false);return}
    try{
      const {data,error}=await backend.from('notifications').select('id,kind,letter_id,created_at,read_at').order('created_at',{ascending:false}).limit(100);
      checkError(error);
      setItems(data??[]);
    }catch(e){
      const msg=(e as Error).message||String(e);
      if(!navigator.onLine||msg.toLowerCase().includes('fetch')||msg.toLowerCase().includes('network')){
        setItems([]);
      }else{
        setError(msg);
      }
    }finally{
      setLoading(false);
    }
  },[account?.id,account?.local]);
  useEffect(()=>{void load().catch(()=>{setLoading(false)})},[load]);
  const read=async(id:string)=>{
    try{
      await markNotificationRead(id);
      setItems(rows=>rows.map(row=>row.id===id?{...row,read_at:new Date().toISOString()}:row));
    }catch(e){
      const msg=(e as Error).message||String(e);
      setError(msg.toLowerCase().includes('fetch')?'Unable to reach cloud service right now. Please try again in a moment.':msg);
    }
  };
  if(loading)return <Loading/>;
  return <div className="notifications-room"><div className="page-heading"><p className="eyebrow">QUIET REMINDERS</p><h1>Your notifications.</h1><p>Letter availability, storage warnings, and service messages appear here without private diary content.</p></div>{error&&<Message error>{error}<button className="dismiss" aria-label="Dismiss error" onClick={()=>setError('')}><X size={15}/></button></Message>}{account?.local?<section className="empty-state"><Bell/><h2>No cloud notifications on this device.</h2><p>A hosted account is required for scheduled-letter and delivery notifications.</p></section>:items.length?<section className="notification-list">{items.map(item=><article key={item.id} className={item.read_at?'read':''}><span>{item.kind==='release'?<Mail/>:<Bell/>}</span><div><h2>{item.kind==='release'?'A future letter is ready.':'A future letter reminder.'}</h2><p>{new Date(item.created_at).toLocaleString()} · Open Future letters for details.</p></div>{!item.read_at&&<button className="button glass" onClick={()=>void read(item.id)}><Check size={15}/> Mark read</button>}</article>)}</section>:<section className="empty-state"><Bell/><h2>All quiet for now.</h2><p>New letter and service notices will appear here.</p></section>}</div>
}
