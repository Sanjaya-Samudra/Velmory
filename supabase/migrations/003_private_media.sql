-- Storage writes go through the media Edge Function. There are deliberately no
-- browser SELECT/INSERT policies on the private bucket (including signed URLs).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('velmory-private','velmory-private',false,524288,array['application/octet-stream'])
 on conflict(id) do update set public=false,file_size_limit=524288,allowed_mime_types=array['application/octet-stream'];
create table public.media_objects(
 id uuid primary key,owner_id uuid not null references auth.users(id) on delete cascade,
 purpose text not null check(purpose in ('diary','letter')),bytes bigint not null check(bytes between 17 and 8388608),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),state text not null default 'reserved' check(state in ('reserved','ready','deleting')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',
 letter_id uuid references public.letters(id) on delete set null
);
create table public.media_chunks(media_id uuid not null references public.media_objects(id) on delete cascade,part int not null check(part between 0 and 15),bytes int not null check(bytes between 1 and 524288),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),primary key(media_id,part));
create index media_owner on public.media_objects(owner_id,state);
alter table public.media_objects enable row level security;alter table public.media_chunks enable row level security;
revoke all on public.media_objects,public.media_chunks from anon,authenticated;
create policy own_media_manifest on public.media_objects for select to authenticated using(owner_id=auth.uid() and public.active_user());
grant select on public.media_objects to authenticated;
create function public.account_usage(p_owner uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce((select sum(octet_length(envelope::text)) from public.documents where owner_id=p_owner),0)
 +coalesce((select sum(bytes) from public.media_objects where owner_id=p_owner),0)
 +coalesce((select sum(octet_length(s.payload::text)+octet_length(s.wrapped_key)) from public.letter_secrets s join public.letters l on l.id=s.letter_id where l.sender_id=p_owner),0)
$$;
revoke all on function public.account_usage(uuid) from public,anon,authenticated;
create function public.storage_usage() returns jsonb language plpgsql stable security definer set search_path='' as $$declare quota bigint;used bigint;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select quota_bytes into quota from public.profiles where id=auth.uid();used:=public.account_usage(auth.uid());
 return jsonb_build_object('used_bytes',used,'quota_bytes',quota,'warning',used>=quota*0.8);
end$$;
create or replace function public.save_document(p_id text,p_expected_revision bigint,p_envelope jsonb,p_deleted boolean default false) returns bigint language plpgsql security definer set search_path='' as $$declare old public.documents;allowed bigint;used bigint;result bigint;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_deleted is null or p_id is null or p_id!~'^(diary|letter|settings):[a-zA-Z0-9:-]{1,100}$' or not public.valid_cipher(p_envelope) then raise exception 'Invalid encrypted document';end if;
 select quota_bytes into allowed from public.profiles where id=auth.uid() for update;
 select * into old from public.documents where owner_id=auth.uid() and id=p_id;
 if found and old.envelope=p_envelope and old.deleted=p_deleted then return old.revision;end if;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception 'revision_conflict';end if;
 used:=public.account_usage(auth.uid())-coalesce(octet_length(old.envelope::text),0)+octet_length(p_envelope::text);
 if used>allowed then raise exception 'Storage allowance reached';end if;
 result:=coalesce(old.revision,0)+1;
 insert into public.documents(owner_id,id,envelope,revision,deleted) values(auth.uid(),p_id,p_envelope,result,p_deleted) on conflict(owner_id,id) do update set envelope=excluded.envelope,revision=excluded.revision,deleted=excluded.deleted,updated_at=clock_timestamp();return result;
end$$;
create function public.reserve_media(p_id uuid,p_bytes bigint,p_sha256 text,p_purpose text) returns jsonb language plpgsql security definer set search_path='' as $$declare m public.media_objects;q bigint;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select quota_bytes into q from public.profiles where id=auth.uid() for update;
 select * into m from public.media_objects where id=p_id;
 if found then
  if m.owner_id<>auth.uid() or m.bytes is distinct from p_bytes or m.sha256 is distinct from p_sha256 or m.purpose is distinct from p_purpose or m.state='deleting' then raise exception 'Upload unavailable';end if;
  return jsonb_build_object('id',m.id,'state',m.state,'chunk_bytes',524288);
 end if;
 if p_bytes is null or p_bytes not between 17 and 8388608 or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or p_purpose is null or p_purpose not in ('diary','letter') then raise exception 'Invalid upload';end if;
 perform public.consume_rate('reserve_upload',100);
 if public.account_usage(auth.uid())+p_bytes>q then raise exception 'Storage allowance reached';end if;
 insert into public.media_objects(id,owner_id,purpose,bytes,sha256) values(p_id,auth.uid(),p_purpose,p_bytes,p_sha256);
 return jsonb_build_object('id',p_id,'state','reserved','chunk_bytes',524288);
end$$;
create function public.media_access(p_id uuid,p_write boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$declare m public.media_objects;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select * into m from public.media_objects where id=p_id;
 if not found or m.state='deleting' then raise exception 'Media unavailable';end if;
 if p_write then
  if m.owner_id<>auth.uid() or m.state<>'reserved' or m.expires_at<=now() then raise exception 'Upload unavailable';end if;
 elsif m.owner_id<>auth.uid() then
  if m.state<>'ready' or m.purpose<>'letter' or not exists(select 1 from public.letters l join public.profiles p on p.id=l.sender_id where l.id=m.letter_id and l.recipient_id=auth.uid() and l.opens_at<=now() and l.status<>'cancelled' and p.status='active') then raise exception 'Media unavailable';end if;
 end if;
 return to_jsonb(m)||jsonb_build_object('chunks',coalesce((select jsonb_agg(c order by c.part) from public.media_chunks c where c.media_id=m.id),'[]'::jsonb));
end$$;
create function public.record_media_chunk(p_owner uuid,p_id uuid,p_part int,p_bytes int,p_sha256 text) returns void language plpgsql security definer set search_path='' as $$declare m public.media_objects;c public.media_chunks;expected int;begin
 select * into m from public.media_objects where id=p_id and owner_id=p_owner for update;
 if not found or m.state<>'reserved' or m.expires_at<=now() or not exists(select 1 from public.profiles where id=p_owner and status='active') then raise exception 'Upload unavailable';end if;
 expected:=least(524288,m.bytes-p_part::bigint*524288);
 if p_part is null or p_part<0 or expected<=0 or p_bytes is distinct from expected then raise exception 'Invalid chunk';end if;
 select * into c from public.media_chunks where media_id=p_id and part=p_part;
 if found then if c.sha256 is distinct from p_sha256 or c.bytes is distinct from p_bytes then raise exception 'Chunk conflict';end if;return;end if;
 insert into public.media_chunks values(p_id,p_part,p_bytes,p_sha256);
end$$;
create function public.commit_media(p_owner uuid,p_id uuid,p_sha256 text) returns void language plpgsql security definer set search_path='' as $$declare m public.media_objects;begin
 select * into m from public.media_objects where id=p_id and owner_id=p_owner for update;
 if not found or m.state='deleting' or not exists(select 1 from public.profiles where id=p_owner and status='active') then raise exception 'Upload unavailable';end if;
 if m.sha256 is distinct from p_sha256 or (select coalesce(sum(bytes),0) from public.media_chunks where media_id=p_id)<>m.bytes then raise exception 'Incomplete or modified upload';end if;
 update public.media_objects set state='ready' where id=p_id;
end$$;
create function public.delete_media(p_id uuid) returns void language plpgsql security definer set search_path='' as $$declare m public.media_objects;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select * into m from public.media_objects where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception 'Media unavailable';end if;
 if m.letter_id is not null and exists(select 1 from public.letters where id=m.letter_id and status<>'cancelled') then raise exception 'Cancel delivery before removing its attachment';end if;
 update public.media_objects set state='deleting' where id=p_id;
end$$;
create function public.seal_letter_with_media(p_id uuid,p_recipient uuid,p_opens_at timestamptz,p_timezone text,p_payload jsonb,p_wrapped_key text,p_recipient_key text,p_media uuid[] default '{}') returns void language plpgsql security definer set search_path='' as $$declare actual_key text;q bigint;old public.letters;s public.letter_secrets;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select quota_bytes into q from public.profiles where id=auth.uid() for update;
 select * into old from public.letters where id=p_id;
 if found then
  select * into s from public.letter_secrets where letter_id=p_id;
  if old.sender_id=auth.uid() and old.status<>'cancelled' and old.recipient_id=p_recipient and old.opens_at=p_opens_at and old.timezone=p_timezone and s.payload=p_payload and s.wrapped_key=p_wrapped_key and s.recipient_key=p_recipient_key and coalesce((select array_agg(id order by id) from public.media_objects where letter_id=p_id),'{}'::uuid[])=coalesce((select array_agg(x order by x) from unnest(p_media)x),'{}'::uuid[]) then return;end if;
  raise exception 'Letter identifier already used';
 end if;
 if p_opens_at is null or p_opens_at<=now() or p_opens_at>now()+interval '100 years' or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid opening date or timezone';end if;
 actual_key:=public.resolve_recipient(p_recipient)->>'public_key';
 if p_recipient_key is distinct from actual_key then raise exception 'Recipient key changed. Refresh and confirm the recipient again.';end if;
 if not public.valid_cipher(p_payload) or octet_length(p_payload::text)>100000 or p_wrapped_key is null or length(p_wrapped_key) not between 80 and 512 or p_media is null or cardinality(p_media)>10 or cardinality(p_media)<>(select count(distinct x) from unnest(p_media)x) then raise exception 'Invalid letter payload';end if;
 perform public.consume_rate('seal_letter',5);
 if public.account_usage(auth.uid())+octet_length(p_payload::text)+octet_length(p_wrapped_key)>q then raise exception 'Storage allowance reached';end if;
 perform 1 from public.media_objects where id=any(p_media) order by id for update;
 if (select count(*) from public.media_objects where id=any(p_media) and owner_id=auth.uid() and purpose='letter' and state='ready' and letter_id is null)<>cardinality(p_media) then raise exception 'Attachments must be separately encrypted completed uploads';end if;
 insert into public.letters(id,sender_id,recipient_id,opens_at,timezone)values(p_id,auth.uid(),p_recipient,p_opens_at,p_timezone);
 insert into public.letter_secrets values(p_id,p_payload,p_wrapped_key,p_recipient_key);
 update public.media_objects set letter_id=p_id where id=any(p_media);
 insert into public.notification_jobs(letter_id,user_id,kind,due_at)values(p_id,p_recipient,'release',p_opens_at);
 if p_opens_at>now()+interval '24 hours' then insert into public.notification_jobs(letter_id,user_id,kind,due_at)values(p_id,p_recipient,'reminder',p_opens_at-interval '24 hours');end if;
end$$;
create or replace function public.seal_letter(p_id uuid,p_recipient uuid,p_opens_at timestamptz,p_timezone text,p_payload jsonb,p_wrapped_key text,p_recipient_key text) returns void language sql security definer set search_path='' as $$select public.seal_letter_with_media(p_id,p_recipient,p_opens_at,p_timezone,p_payload,p_wrapped_key,p_recipient_key,'{}')$$;
create or replace function public.open_letter(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare l public.letters;s public.letter_secrets;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select * into l from public.letters where id=p_id and recipient_id=auth.uid() for update;
 if not found or l.status='cancelled' or l.opens_at>now() or not exists(select 1 from public.profiles where id=l.sender_id and status='active') then raise exception 'This letter is not available to open';end if;
 select * into s from public.letter_secrets where letter_id=p_id;if not found then raise exception 'Letter unavailable';end if;
 update public.letters set status='released' where id=p_id;
 return jsonb_build_object('payload',s.payload,'wrapped_key',s.wrapped_key,'media',coalesce((select jsonb_agg(jsonb_build_object('id',id,'bytes',bytes,'sha256',sha256)) from public.media_objects where letter_id=p_id and state='ready'),'[]'::jsonb));
end$$;
revoke all on function public.storage_usage(),public.reserve_media(uuid,bigint,text,text),public.media_access(uuid,boolean),public.delete_media(uuid),public.seal_letter_with_media(uuid,uuid,timestamptz,text,jsonb,text,text,uuid[]) from public,anon;
grant execute on function public.storage_usage(),public.reserve_media(uuid,bigint,text,text),public.media_access(uuid,boolean),public.delete_media(uuid),public.seal_letter_with_media(uuid,uuid,timestamptz,text,jsonb,text,text,uuid[]) to authenticated;
revoke all on function public.record_media_chunk(uuid,uuid,int,int,text),public.commit_media(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_media_chunk(uuid,uuid,int,int,text),public.commit_media(uuid,uuid,text) to service_role;
grant all on public.media_objects,public.media_chunks,public.service_settings,public.rate_windows to service_role;
