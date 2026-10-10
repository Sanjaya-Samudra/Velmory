import {createClient,type SupabaseClient} from '@supabase/supabase-js';

export interface Runtime {env:(name:string)=>string|undefined; fetch:typeof fetch}
export class HttpError extends Error {constructor(public status:number,message:string){super(message)}}
export const checked=<T>(result:{data:T;error:unknown}):T=>{if(result.error)throw new HttpError(409,'The operation was rejected. Check access, revision, capacity, and request values.');return result.data};
export function clients(runtime:Runtime,request:Request){
 const url=runtime.env('SUPABASE_URL'),key=runtime.env('SUPABASE_ANON_KEY'),service=runtime.env('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key||!service)throw new HttpError(503,'Service configuration incomplete');
 const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:runtime.fetch}};
 return {user:createClient(url,key,{...options,global:{...options.global,headers:{Authorization:request.headers.get('Authorization')??''}}}),admin:createClient(url,service,options)};
}
export async function authenticate(user:SupabaseClient){const {data,error}=await user.auth.getUser();if(error||!data.user)throw new HttpError(401,'Sign in to continue');return data.user}
export async function bytes(request:Request,max:number){
 if(Number(request.headers.get('Content-Length'))>max)throw new HttpError(413,'Payload too large');
 if(!request.body)throw new HttpError(400,'Body required');
 const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new HttpError(413,'Payload too large')}parts.push(value)}}finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length}return result;
}
export async function json(request:Request,max=4096):Promise<Record<string,unknown>>{try{const value=JSON.parse(new TextDecoder().decode(await bytes(request,max)));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON body')}}
export const uuid=(value:unknown)=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new HttpError(400,'Invalid identifier');return value};
export async function sha256(value:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',value as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export function endpoint(runtime:Runtime,handler:(req:Request)=>Promise<Response>){return async(req:Request)=>{
 const origin=runtime.env('APP_URL')??'http://127.0.0.1:5173';const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(req.headers.has('Origin')&&req.headers.get('Origin')!==origin)return new Response('Origin unavailable',{status:403,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{const response=await handler(req);for(const [k,v] of Object.entries(headers))response.headers.set(k,v);return response}catch(e){return Response.json({error:e instanceof HttpError?e.message:'Service temporarily unavailable'},{status:e instanceof HttpError?e.status:503,headers})}
}}
export function schedulerAuthorized(req:Request,runtime:Runtime){const secret=runtime.env('SCHEDULER_SECRET');if(req.method!=='POST')throw new HttpError(405,'POST required');if(!secret||req.headers.get('Authorization')!==`Bearer ${secret}`)throw new HttpError(401,'Unauthorized')}
