create function public.validate_vault() returns trigger language plpgsql set search_path='' as $$begin
 if new.envelope->>'v' is distinct from '1' or new.envelope->>'publicKey' is distinct from new.public_key or length(new.public_key) not between 42 and 44 or not public.valid_cipher(new.envelope->'pass') or not public.valid_cipher(new.envelope->'recovery') or new.envelope->>'ops' is distinct from '2' or new.envelope->>'mem' is distinct from '67108864' or length(coalesce(new.envelope->>'salt','')) not between 20 and 24 or octet_length(new.envelope::text)>16384 then raise exception 'Invalid vault envelope';end if;return new;
end$$;
create trigger valid_vault_envelope before insert or update on public.vaults for each row execute function public.validate_vault();
revoke all on function public.validate_vault() from public,anon,authenticated;
create or replace function public.admin_account(p_id uuid,p_status text,p_quota bigint) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 if p_status is null or p_status not in ('active','suspended') or p_quota is null or p_quota not between 1048576 and 1073741824 then raise exception 'Invalid account settings';end if;
 if p_id=auth.uid() and p_status='suspended' then raise exception 'Cannot suspend your current administrator account';end if;
 update public.profiles set status=p_status,quota_bytes=p_quota where id=p_id and status<>'deleting';if not found then raise exception 'Account unavailable';end if;
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'account_update',p_id::text);
end$$;
create or replace function public.admin_publish_content(p_id uuid) returns void language plpgsql security definer set search_path='' as $$declare c public.public_content;begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 select * into c from public.public_content where id=p_id;
 if not found or public.valid_public_body(c.body,c.kind) is distinct from true then raise exception 'Valid content not found';end if;
 perform pg_advisory_xact_lock(hashtext(c.slug));update public.public_content set published=false where slug=c.slug;update public.public_content set published=true where id=p_id;
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'publish_content',p_id::text);
end$$;
