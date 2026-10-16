import {reportOperationalEvent} from './service';

const sent=new Set<string>();
export function reportClientFailure(code:'render_failure'|'uncaught_error'|'unhandled_rejection'|'service_worker_failure'){
 if(sent.has(code))return;sent.add(code);
 void reportOperationalEvent('ui',code).catch(()=>{});
}
export function installFailureReporting(){
 const error=()=>reportClientFailure('uncaught_error');
 const rejection=()=>reportClientFailure('unhandled_rejection');
 addEventListener('error',error);addEventListener('unhandledrejection',rejection);
 return()=>{removeEventListener('error',error);removeEventListener('unhandledrejection',rejection)};
}
