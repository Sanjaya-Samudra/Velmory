import {useEffect, useState} from 'react';
import {backend, checkError} from '../core/backend';
import Select from '../components/Select';
import {Message} from '../components/Status';

type Kind = 'announcement' | 'page' | 'cover' | 'sticker';
type Item = {name:string; asset_id:string};
type Section = {heading:string; text:string; asset_id?:string};
export type ContentRevision = {
  id:string; slug:string; kind:Kind; revision:number; published:boolean;
  body:{title?:string; text?:string; description?:string; items?:Item[]; sections?:Section[]};
};

async function uploadArtwork(file:File):Promise<string> {
  if (!backend) throw new Error('Connect a hosted account to upload artwork.');
  if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5*1024*1024)
    throw new Error('Choose a PNG, JPEG, or WebP image under 5 MB.');
  const {data,error}=await backend.auth.getSession();checkError(error);
  if (!data.session) throw new Error('Sign in before uploading artwork.');
  const id=crypto.randomUUID();
  const url=new URL(import.meta.env.VITE_SUPABASE_URL+'/functions/v1/artwork');
  url.searchParams.set('id',id);
  const response=await fetch(url,{method:'PUT',body:file,headers:{
    Authorization:'Bearer '+data.session.access_token,
    apikey:import.meta.env.VITE_SUPABASE_ANON_KEY,
    'Content-Type':file.type,
  }});
  if (!response.ok) {
    const result=await response.json().catch(()=>({}));
    throw new Error(result.error ?? 'Artwork upload failed.');
  }
  return id;
}

function RevisionPreview({revision}:{revision:ContentRevision}) {
  const {body,kind}=revision;
  return <div className="content-revision-preview">
    <p className="eyebrow">{kind} · revision {revision.revision} · {revision.published?'Published':'Draft'}</p>
    <h3>{body.title || revision.slug}</h3>
    {body.description&&<p>{body.description}</p>}
    {body.text&&<p>{body.text}</p>}
    {body.sections?.map((section,index)=><section key={index}>
      <h4>{section.heading}</h4><p>{section.text}</p>
      {section.asset_id&&<small>Artwork: {section.asset_id}</small>}
    </section>)}
    {body.items?.map((item,index)=><p key={index}>{item.name} · artwork {item.asset_id}</p>)}
  </div>;
}

export default function AdminContentStudio({content,onChange}:{content:ContentRevision[];onChange:()=>Promise<void>}) {
  const [kind,setKind]=useState<Kind>('announcement');
  const [slug,setSlug]=useState('announcement');
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [text,setText]=useState('');
  const [items,setItems]=useState<Item[]>([{name:'',asset_id:''}]);
  const [sections,setSections]=useState<Section[]>([{heading:'',text:''}]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [preview,setPreview]=useState<ContentRevision|null>(null);
  const [filter,setFilter]=useState<Kind|'all'>('all');

  useEffect(()=>{if(preview){const updated=content.find(row=>row.id===preview.id);if(updated)setPreview(updated)}},[content]);
  const run=async(work:()=>Promise<void>)=>{
    setError('');setNotice('');setBusy(true);
    try{await work();await onChange()}
    catch(cause){setError((cause as Error).message)}
    finally{setBusy(false)}
  };
  const body=()=>{
    if(kind==='announcement')return {text:text.trim()};
    if(kind==='page')return {title:title.trim(),description:description.trim(),sections:sections.map(s=>({
      heading:s.heading.trim(),text:s.text.trim(),...(s.asset_id?{asset_id:s.asset_id}:{}),
    }))};
    return {title:title.trim(),description:description.trim(),items:items.map(item=>({
      name:item.name.trim(),asset_id:item.asset_id,
    }))};
  };
  const choose=(row:ContentRevision)=>{
    setKind(row.kind);setSlug(row.slug);setTitle(row.body.title??'');
    setDescription(row.body.description??'');setText(row.body.text??'');
    setItems(row.body.items?.map(item=>({...item}))??[{name:'',asset_id:''}]);
    setSections(row.body.sections?.map(section=>({...section}))??[{heading:'',text:''}]);
    setPreview(row);
  };
  const artwork=async(file:File,index:number,which:'item'|'section')=>run(async()=>{
    const id=await uploadArtwork(file);
    if(which==='item')setItems(current=>current.map((item,i)=>i===index?{...item,asset_id:id}:item));
    else setSections(current=>current.map((section,i)=>i===index?{...section,asset_id:id}:section));
    setNotice('Artwork uploaded. Save and publish a revision to make it public.');
  });
  const rows=[...content].filter(row=>filter==='all'||row.kind===filter)
    .sort((a,b)=>a.slug.localeCompare(b.slug)||b.revision-a.revision);
  return <section className="settings-card admin-content-studio">
    <h2>Public content studio</h2>
    <p>Save a draft, inspect its exact structured content, then publish it. Earlier revisions remain available for rollback.</p>
    {error&&<Message error>{error}</Message>}{notice&&<Message>{notice}</Message>}
    <form onSubmit={event=>{event.preventDefault();void run(async()=>{
      const {error}=await backend!.rpc('admin_save_content',{p_slug:slug,p_kind:kind,p_body:body()});
      checkError(error);setNotice('Draft saved. Select it below to preview or publish.');
    })}}>
      <Select label="Content type" value={kind} onChange={value=>setKind(value as Kind)} options={[
        {value:'announcement',label:'Announcement'},
        {value:'page',label:'Public page'},
        {value:'cover',label:'Cover collection'},
        {value:'sticker',label:'Sticker collection'},
      ]}/>
      <label>Content identifier<input value={slug} pattern="[a-z0-9-]{1,80}" required onChange={e=>setSlug(e.target.value)} /></label>
      {kind!=='announcement'&&<><label>Title<input maxLength={150} required value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label>Description<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={2000}/></label></>}
      {kind==='announcement'&&<label>Announcement text<textarea value={text} onChange={e=>setText(e.target.value)} maxLength={2000} required/></label>}
      {kind==='page'&&<div className="studio-rows"><h3>Page sections</h3>{sections.map((section,index)=><div className="studio-row" key={index}>
        <label>Heading<input maxLength={150} value={section.heading} onChange={e=>setSections(current=>current.map((s,i)=>i===index?{...s,heading:e.target.value}:s))}/></label>
        <label>Text<textarea maxLength={4000} value={section.text} onChange={e=>setSections(current=>current.map((s,i)=>i===index?{...s,text:e.target.value}:s))}/></label>
        <label>Artwork (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void artwork(file,index,'section')}}/></label>
        {section.asset_id&&<small>Uploaded artwork: {section.asset_id}</small>}
        <button type="button" className="text-link" disabled={sections.length===1} onClick={()=>setSections(current=>current.filter((_,i)=>i!==index))}>Remove section</button>
      </div>)}<button type="button" className="button glass small" disabled={sections.length>=30} onClick={()=>setSections(current=>[...current,{heading:'',text:''}])}>Add section</button></div>}
      {(kind==='cover'||kind==='sticker')&&<div className="studio-rows"><h3>{kind==='cover'?'Cover designs':'Sticker designs'}</h3>{items.map((item,index)=><div className="studio-row" key={index}>
        <label>Name<input maxLength={100} required value={item.name} onChange={e=>setItems(current=>current.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>
        <label>Artwork<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void artwork(file,index,'item')}}/></label>
        {item.asset_id&&<small>Uploaded artwork: {item.asset_id}</small>}
        <button type="button" className="text-link" disabled={items.length===1} onClick={()=>setItems(current=>current.filter((_,i)=>i!==index))}>Remove design</button>
      </div>)}<button type="button" className="button glass small" disabled={items.length>=100} onClick={()=>setItems(current=>[...current,{name:'',asset_id:''}])}>Add design</button></div>}
      <button className="button gold" disabled={busy}>{busy?'Saving…':'Save draft'}</button>
    </form>
    <div className="studio-revisions">
      <h3>Revisions</h3>
      <Select label="Show revisions" value={filter} onChange={v=>setFilter(v as Kind|'all')} options={[
        {value:'all',label:'All types'},{value:'announcement',label:'Announcements'},
        {value:'page',label:'Pages'},{value:'cover',label:'Covers'},{value:'sticker',label:'Stickers'},
      ]}/>
      {rows.map(row=><div className="studio-revision" key={row.id}>
        <span><strong>{row.slug} · revision {row.revision}</strong><small>{row.kind} · {row.published?'Published':'Draft'}</small></span>
        <button className="button glass small" type="button" onClick={()=>choose(row)}>Preview and edit</button>
        {!row.published&&<button className="button glass small" type="button" disabled={busy} onClick={()=>void run(async()=>{
          checkError((await backend!.rpc('admin_publish_content',{p_id:row.id})).error);
          setNotice('Revision published.');
        })}>Publish / restore</button>}
        {row.published&&<button className="text-link" type="button" disabled={busy} onClick={()=>void run(async()=>{
          checkError((await backend!.rpc('admin_unpublish_content',{p_slug:row.slug})).error);
          setNotice('Content unpublished.');
        })}>Unpublish</button>}
      </div>)}
      {preview&&<RevisionPreview revision={preview}/>}
    </div>
  </section>;
}
