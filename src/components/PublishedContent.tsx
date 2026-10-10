import {useEffect,useState} from 'react';
import {backend} from '../core/backend';

type Content = {
 id:string; slug:string; kind:'announcement'|'page'; body:{
  title?:string;description?:string;text?:string;
  sections?:{heading:string;text:string;asset_id?:string}[];
 };
};
function Artwork({id}:{id:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  if(!import.meta.env.VITE_SUPABASE_URL)return;
  const controller=new AbortController();
  const address=new URL(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/artwork');
  address.searchParams.set('id',id);
  let blobUrl='';
  void fetch(address,{signal:controller.signal,headers:{apikey:import.meta.env.VITE_SUPABASE_ANON_KEY}})
   .then(response=>response.ok?response.blob():null)
   .then(blob=>{if(blob&&!controller.signal.aborted){blobUrl=URL.createObjectURL(blob);setUrl(blobUrl)}})
   .catch(()=>{});
  return()=>{controller.abort();if(blobUrl)URL.revokeObjectURL(blobUrl)};
 },[id]);
 return url?<img src={url} alt="" loading="lazy"/>:null;
}
export default function PublishedContent({path}:{path:string}){
 const [content,setContent]=useState<Content[]>([]);
 useEffect(()=>{
  if(!backend)return;
  let alive=true;
  void backend.from('public_content').select('id,slug,kind,body').eq('published',true)
   .in('kind',['announcement','page']).then(({data,error})=>{
    if(alive&&!error)setContent((data??[]) as Content[]);
   });
  return()=>{alive=false};
 },[]);
 const slug=path==='/'?'home':path.replace(/^\//,'');
 const pages=content.filter(item=>item.kind==='page'&&item.slug===slug);
 const announcements=path==='/'?content.filter(item=>item.kind==='announcement'):[];
 if(!pages.length&&!announcements.length)return null;
 return <div className="published-content">
  {announcements.map(item=><aside className="published-announcement" key={item.id} aria-label="Announcement">
   {item.body.title&&<strong>{item.body.title}</strong>}<p>{item.body.text}</p>
  </aside>)}
  {pages.map(item=><section className="published-page" key={item.id}>
   <p className="eyebrow">FROM VELMORY</p><h2>{item.body.title}</h2>
   {item.body.description&&<p>{item.body.description}</p>}
   <div className="published-sections">{item.body.sections?.map((section,index)=><article key={index}>
    {section.asset_id&&<Artwork id={section.asset_id}/>}
    <h3>{section.heading}</h3><p>{section.text}</p>
   </article>)}</div>
  </section>)}
 </div>;
}
