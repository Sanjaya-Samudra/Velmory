create function public.admin_register_artwork(p_id uuid,p_mime text,p_bytes int,p_sha256 text) returns void language plpgsql security definer set search_path='' as $$declare previous public.public_assets;begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 select * into previous from public.public_assets where id=p_id;
 if found then if previous.sha256 is distinct from p_sha256 or previous.mime is distinct from p_mime or previous.bytes is distinct from p_bytes then raise exception 'Artwork is immutable';end if;return;end if;
 insert into public.public_assets(id,path,mime,bytes,sha256,created_by)values(p_id,p_id::text||'/'||p_sha256,p_mime,p_bytes,p_sha256,auth.uid());
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'artwork_upload',p_id::text);
end$$;
revoke all on function public.admin_register_artwork(uuid,text,int,text) from public,anon;
grant execute on function public.admin_register_artwork(uuid,text,int,text) to authenticated;
