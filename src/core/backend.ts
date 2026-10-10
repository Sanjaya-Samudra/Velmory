import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL,anon=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const backend=url&&anon?createClient(url,anon,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
export const emailReady=import.meta.env.VITE_EMAIL_AUTH_READY==='true';
export function checkError(error:{message:string}|null){if(error)throw new Error(error.message)}
