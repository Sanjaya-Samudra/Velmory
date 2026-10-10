import {useEffect,useState} from 'react';
import {backend} from '../core/backend';
import {imageData} from '../core/content';

type Option={id:string;name:string;art:string};
type Collection={id:string;body:{title:string;items:{name:string;asset_id:string}[]}};
export default function PublishedCovers({selected,onChoose}:{selected:string;onChoose:(art:string)=>void}){
 const [collections,setCollections]=useState<{title:string;options:Option[]}[]>([]);
 useEffect(()=>{
  if(!backend||!import.meta.env.VITE_SUPABASE_URL)return;
  let alive=true;
  void (async()=>{
   const {data,error}=await backend.from('public_content').select('id,body')
    .eq('kind','cover').eq('published',true);
   if(error||!data)return;
   const result=await Promise.all((data as Collection[]).slice(0,5).map(async collection=>{
    const options=await Promise.all(collection.body.items.slice(0,12).map(async item=>{
     try{
      const url=new URL(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/artwork');
      url.searchParams.set('id',item.asset_id);
      const response=await fetch(url,{headers:{apikey:import.meta.env.VITE_SUPABASE_ANON_KEY}});
      if(!response.ok)return null;
      const blob=await response.blob();
      return {id:item.asset_id,name:item.name,art:await imageData(new File([blob],item.name,{type:blob.type}))};
     }catch{return null}
    }));
    return {title:collection.body.title,options:options.filter((option):option is Option=>!!option)};
   }));
   if(alive)setCollections(result.filter(collection=>collection.options.length));
  })();
  return()=>{alive=false};
 },[]);
 if(!collections.length)return null;
 return <div className="published-cover-collections">{collections.map(collection=><div key={collection.title}>
  <p>{collection.title}</p><div className="published-cover-options">{collection.options.map(option=><button
   key={option.id} type="button" className={selected===option.art?'selected':''}
   aria-label={option.name+' cover'} aria-pressed={selected===option.art}
   onClick={()=>onChoose(option.art)}>
   <img src={option.art} alt=""/><span>{option.name}</span>
  </button>)}</div>
 </div>)}</div>;
}
