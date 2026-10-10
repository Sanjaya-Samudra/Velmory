import {Feather,Mic} from 'lucide-react';
import type {DiaryPage} from '../core/types';
import {safeHtml} from '../core/content';
import AudioMemory from './AudioMemory';
import {WaxSeal} from './SealedPage';

export default function BookPagePreview({page,number,title,scale,side,decorative=false,onChoose}:{page?:DiaryPage;number:number;title:string;scale:number;side:'left'|'right';decorative?:boolean;onChoose?:()=>void}) {
 return <article className={'diary-paper book-preview-page '+(side==='left'?'facing-page':'')} data-page-number={number} style={{transform:`scale(${scale})`}} onClick={onChoose}>
  <div className="paper-header"><small>{page?.seal?'PASSWORD PROTECTED':page?.date||title}</small><h2>{page?.title||'The other side is waiting.'}</h2><span>✧</span></div>
  {page?.seal?<div className="facing-intro facing-sealed"><WaxSeal/><p>This page is password protected.</p></div>:page?.objects.map(o=>o.kind==='drawing'?<svg key={o.id} className="drawing-layer" viewBox="0 0 500 700" aria-label="Handwritten drawing"><polyline points={o.points?.map(p=>p.join(',')).join(' ')} fill="none" stroke={o.color||'#4c473d'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>:<div key={o.id} className={'page-object '+o.kind} style={{left:o.x,top:o.y,width:o.width,minHeight:o.height,transform:`rotate(${o.rotation}deg)`,fontFamily:o.fontFamily||(o.kind==='text'?'Georgia':undefined),fontSize:o.fontSize,color:o.color,textAlign:o.textAlign}}>{o.kind==='text'?<div dangerouslySetInnerHTML={{__html:safeHtml(o.content)}}/>:o.kind==='photo'?<figure><img src={o.content} alt={o.label||'Diary photograph'}/><figcaption>{o.label||'A moment to keep.'}</figcaption></figure>:o.kind==='sticker'?<span className="sticker-symbol">{o.content}</span>:decorative?<div className="turn-audio"><Mic size={18}/> Audio memory</div>:<AudioMemory object={o}/>}</div>)}
  {!page?.seal&&!page?.objects.length&&<div className="blank-page-note"><Feather/><p>{page?'A little room for another memory.':'Every sheet has two sides.'}</p><span>{page?'This side is yours to fill.':'Add a sheet to continue your story.'}</span></div>}
  <span className="paper-folio">— {number} —</span>
 </article>;
}
