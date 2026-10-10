import {AlertTriangle,X} from 'lucide-react';
import {useId} from 'react';

export default function ConfirmDialog({title,description,confirmLabel,cancelLabel='Keep it',busy=false,onCancel,onConfirm}:{title:string;description:string;confirmLabel:string;cancelLabel?:string;busy?:boolean;onCancel:()=>void;onConfirm:()=>void}){
 const id=useId();
 return <div className="modal-backdrop confirmation-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel()}}>
  <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby={id+'-title'} aria-describedby={id+'-description'} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();onCancel()}}}>
   <button className="confirmation-close" aria-label="Close confirmation" disabled={busy} onClick={onCancel}><X size={18}/></button>
   <div className="confirmation-emblem" aria-hidden="true"><AlertTriangle size={28}/></div>
   <p className="eyebrow">A MOMENT TO BE SURE</p>
   <h2 id={id+'-title'}>{title}</h2>
   <p id={id+'-description'}>{description}</p>
   <div className="confirmation-actions"><button className="button glass" autoFocus disabled={busy} onClick={onCancel}>{cancelLabel}</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy?'Please wait…':confirmLabel}</button></div>
  </section>
 </div>;
}
