import {AlertCircle,LoaderCircle} from 'lucide-react';
export function Message({children,error=false}:{children:React.ReactNode;error?:boolean}){return <div className={`message ${error?'error':''}`} role={error?'alert':'status'}><AlertCircle size={17}/><span>{children}</span></div>}
export function Loading(){return <div className="loading-screen"><LoaderCircle className="spin"/><p>Opening your world…</p></div>}
