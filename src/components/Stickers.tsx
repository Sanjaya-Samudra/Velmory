import {useEffect,useState} from 'react';
import {backend} from '../core/backend';
import {imageData} from '../core/content';

export const stickerCollections={
 Botanical:['🌿','🌸','🌻','🌹','🌺','🪻','🌼','🍃','🍂','🌾','🌵','🦋'],
 Keepsakes:['🎟️','✉️','📮','📷','🗝️','🕯️','🧳','🧭','☕','🎞️','📜','🖋️'],
 Celestial:['☾','☀','✦','✧','★','☆','🌙','🪐','✨','🌌','☁️','🌈'],
 Feelings:['♡','♥','❦','❀','✿','💛','🫶','🎵','🎶','💌','🍀','🕊️'],
} as const;
type Pack={id:string;body:{title:string;items:{name:string;asset_id:string}[]}};

export default function StickerPicker({onChoose}:{onChoose:(content:string,kind?:'sticker'|'photo')=>void}){
 const [packs,setPacks]=useState<Pack[]>([]);
 const [busy,setBusy]=useState<string|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!backend)return;
  let alive=true;
  void backend.from('public_content').select('id,body').eq('kind','sticker').eq('published',true)
   .then(({data,error})=>{if(alive&&!error)setPacks((data??[]) as Pack[])});
  return()=>{alive=false};
 },[]);
 const chooseArtwork=async(item:{name:string;asset_id:string})=>{
  if(!import.meta.env.VITE_SUPABASE_URL)return;
  setBusy(item.asset_id);setError('');
  try{
   const url=new URL(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/artwork');
   url.searchParams.set('id',item.asset_id);
   const response=await fetch(url,{headers:{apikey:import.meta.env.VITE_SUPABASE_ANON_KEY}});
   if(!response.ok)throw new Error('Sticker artwork is unavailable.');
   const blob=await response.blob();
   const data=await imageData(new File([blob],item.name,{type:blob.type}));
   onChoose(data,'photo');
  }catch(cause){setError((cause as Error).message)}
  finally{setBusy(null)}
 };
 return <div className="sticker-library">
  {Object.entries(stickerCollections).map(([name,items])=><section key={name}>
   <h3>{name}</h3><div className="sticker-picker">{items.map(symbol=><button key={symbol} type="button" aria-label={'Add '+symbol+' sticker'} onClick={()=>onChoose(symbol)}>{symbol}</button>)}</div>
  </section>)}
  {packs.map(pack=><section key={pack.id}><h3>{pack.body.title}</h3><div className="sticker-picker">
   {pack.body.items.map(item=><button key={item.asset_id} type="button" disabled={busy===item.asset_id} aria-label={'Add '+item.name+' sticker'} onClick={()=>void chooseArtwork(item)}>{item.name}</button>)}
  </div></section>)}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
