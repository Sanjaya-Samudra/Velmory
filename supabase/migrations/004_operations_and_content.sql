alter table public.notification_jobs add column scheduled_for timestamptz;
update public.notification_jobs set scheduled_for=due_at;
alter table public.notification_jobs alter column scheduled_for set not null;
alter table public.notification_jobs add column claim_token uuid;
alter table public.notification_jobs add column finished_at timestamptz;
create function public.job_schedule_default() returns trigger language plpgsql set search_path='' as $$begin new.scheduled_for:=coalesce(new.scheduled_for,new.due_at);return new;end$$;
create trigger job_schedule before insert on public.notification_jobs for each row execute function public.job_schedule_default();
create table public.email_budget(day date primary key,attempts int not null default 0);
create table public.service_health(name text primary key,last_run timestamptz not null default now(),status text not null check(status in ('ok','error')),code text);
create table public.account_deletions(owner_id uuid primary key references auth.users(id) on delete cascade,requested_at timestamptz not null default now());
alter table public.email_budget enable row level security;alter table public.service_health enable row level security;alter table public.account_deletions enable row level security;
revoke all on public.email_budget,public.service_health,public.account_deletions from anon,authenticated;
create function public.release_due_letters() returns void language plpgsql security definer set search_path='' as $$begin
 update public.letters set status='released' where status='sealed' and opens_at<=now();
 insert into public.notifications(user_id,letter_id,kind)
 select j.user_id,j.letter_id,j.kind from public.notification_jobs j join public.letters l on l.id=j.letter_id join public.profiles p on p.id=j.user_id join public.profiles sender on sender.id=l.sender_id
 where j.scheduled_for<=now() and j.status<>'cancelled' and l.status<>'cancelled' and p.status='active' and sender.status='active' and (j.kind='release' or l.opens_at>now()) on conflict do nothing;
 update public.notification_jobs j set status='cancelled',claim_token=null where j.status not in ('sent','cancelled') and (exists(select 1 from public.letters l where l.id=j.letter_id and (l.status='cancelled' or (j.kind='reminder' and l.opens_at<=now()))) or exists(select 1 from public.account_deletions d where d.owner_id=j.user_id));
end$$;
create or replace function public.claim_notification_jobs() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;remaining int;today date:=(now() at time zone 'UTC')::date;begin
 perform public.release_due_letters();
 insert into public.email_budget(day)values(today) on conflict do nothing;
 perform 1 from public.email_budget where day=today for update;
 select greatest(0,s.daily_email_limit-b.attempts) into remaining from public.service_settings s,public.email_budget b where s.singleton and b.day=today;
 update public.notification_jobs set status='failed',claim_token=null,last_error='lease_expired' where status='processing' and locked_at<now()-interval '10 minutes';
 with picked as(select j.id from public.notification_jobs j join public.profiles p on p.id=j.user_id join public.letters l on l.id=j.letter_id join public.profiles sender on sender.id=l.sender_id
 where j.status in ('pending','failed') and j.attempts<5 and j.due_at<=now() and l.status<>'cancelled' and p.status='active' and sender.status='active' order by j.due_at for update of j skip locked limit least(20,remaining)),
 claimed as(update public.notification_jobs j set status='processing',attempts=attempts+1,locked_at=now(),claim_token=gen_random_uuid() from picked where j.id=picked.id returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'token',c.claim_token,'kind',c.kind,'letter_id',c.letter_id,'email',p.email,'enabled',p.email_notifications)),'[]'::jsonb) into result from claimed c join public.profiles p on p.id=c.user_id;
 update public.email_budget set attempts=attempts+jsonb_array_length(result) where day=today;return result;
end$$;
create function public.prepare_notification(p_id uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare j public.notification_jobs;l public.letters;p public.profiles;begin
 select * into j from public.notification_jobs where id=p_id and claim_token=p_token and status='processing';if not found then return null;end if;
 select * into l from public.letters where id=j.letter_id;
 select * into p from public.profiles where id=j.user_id;
 if l.status='cancelled' or p.status<>'active' or not exists(select 1 from public.profiles where id=l.sender_id and status='active') or (j.kind='reminder' and l.opens_at<=now()) then return null;end if;
 return jsonb_build_object('email',p.email,'enabled',p.email_notifications,'kind',j.kind);
end$$;
create function public.finish_notification(p_id uuid,p_token uuid,p_result text) returns void language plpgsql security definer set search_path='' as $$begin
 if p_result not in ('sent','disabled','cancelled','provider_rejected','provider_timeout') then raise exception 'Invalid outcome';end if;
 update public.notification_jobs set status=case when p_result in ('sent','disabled') then 'sent' when p_result='cancelled' then 'cancelled' else 'failed' end,
 last_error=case when p_result in ('provider_rejected','provider_timeout') then p_result else null end,
 due_at=case when p_result in ('provider_rejected','provider_timeout') then now()+least(3600,60*power(2,attempts)::int)*interval '1 second' else due_at end,
 finished_at=case when p_result in ('sent','disabled','cancelled') then now() else null end,claim_token=null
 where id=p_id and status='processing' and claim_token=p_token;
end$$;
create function public.begin_account_deletion() returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Account unavailable';end if;
 update public.profiles set status='deleting' where id=auth.uid();
 insert into public.account_deletions(owner_id)values(auth.uid()) on conflict do nothing;
 update public.letters set status='cancelled' where sender_id=auth.uid() or recipient_id=auth.uid();
 delete from public.letter_secrets s using public.letters l where l.id=s.letter_id and (l.sender_id=auth.uid() or l.recipient_id=auth.uid());
 update public.notification_jobs set status='cancelled',claim_token=null where user_id=auth.uid() or letter_id in(select id from public.letters where sender_id=auth.uid());
 update public.media_objects set state='deleting' where owner_id=auth.uid();
end$$;
create function public.account_export(p_cursor bigint default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 return jsonb_build_object('format','velmory-server-export','version',1,'changes',public.fetch_changes(p_cursor,100),'vault',(select jsonb_build_object('envelope',envelope,'revision',revision) from public.vaults where owner_id=auth.uid()),'profile',(select to_jsonb(p)-'sync_revision' from public.profiles p where id=auth.uid()),'media',coalesce((select jsonb_agg(m) from public.media_objects m where owner_id=auth.uid() and state='ready'),'[]'::jsonb),'letters',coalesce((select jsonb_agg(l) from public.letters l where sender_id=auth.uid() or recipient_id=auth.uid()),'[]'::jsonb));
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('velmory-artwork','velmory-artwork',false,5242880,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create table public.public_assets(id uuid primary key,path text not null unique,mime text not null check(mime in ('image/png','image/jpeg','image/webp')),bytes int not null check(bytes between 1 and 5242880),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),created_by uuid references auth.users(id) on delete set null,created_at timestamptz not null default now());
alter table public.public_assets enable row level security;revoke all on public.public_assets from anon,authenticated;
create function public.valid_public_body(p_body jsonb,p_kind text) returns boolean language plpgsql stable security definer set search_path='' as $$declare item jsonb;k text;begin
 if p_body is null or jsonb_typeof(p_body)<>'object' or octet_length(p_body::text)>30000 then return false;end if;
 for k in select jsonb_object_keys(p_body) loop if k not in ('title','text','description','sections','items') then return false;end if;end loop;
 if p_kind='announcement' then return jsonb_typeof(p_body->'text')='string' and length(p_body->>'text') between 1 and 2000 and not(p_body ? 'items' or p_body ? 'sections');end if;
 if jsonb_typeof(p_body->'title') is distinct from 'string' or length(p_body->>'title') not between 1 and 150 then return false;end if;
 if p_kind='page' then
  if jsonb_typeof(p_body->'sections') is distinct from 'array' or jsonb_array_length(p_body->'sections')>30 or p_body ? 'items' then return false;end if;
  for item in select jsonb_array_elements(p_body->'sections') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'heading') is distinct from 'string' or jsonb_typeof(item->'text') is distinct from 'string' or length(item->>'heading')>150 or length(item->>'text')>4000 or exists(select 1 from jsonb_object_keys(item) key where key not in ('heading','text','asset_id')) then return false;end if;
   if item ? 'asset_id' and not exists(select 1 from public.public_assets where id::text=item->>'asset_id') then return false;end if;
  end loop;return true;
 elsif p_kind in ('cover','sticker') then
  if jsonb_typeof(p_body->'items') is distinct from 'array' or jsonb_array_length(p_body->'items') not between 1 and 100 or p_body ? 'sections' then return false;end if;
  for item in select jsonb_array_elements(p_body->'items') loop
   if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'name') is distinct from 'string' or length(item->>'name') not between 1 and 100 or exists(select 1 from jsonb_object_keys(item) key where key not in ('name','asset_id')) or not exists(select 1 from public.public_assets where id::text=item->>'asset_id') then return false;end if;
  end loop;return true;
 end if;return false;
end$$;
create or replace function public.admin_save_content(p_slug text,p_body jsonb,p_kind text) returns void language plpgsql security definer set search_path='' as $$declare rev int;begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 if p_slug is null or p_slug!~'^[a-z0-9-]{1,80}$' or public.valid_public_body(p_body,p_kind) is distinct from true then raise exception 'Invalid structured content';end if;
 perform pg_advisory_xact_lock(hashtext(p_slug));
 if exists(select 1 from public.public_content where slug=p_slug and kind<>p_kind) then raise exception 'Content kind cannot change';end if;
 select coalesce(max(revision),0)+1 into rev from public.public_content where slug=p_slug;
 insert into public.public_content(slug,kind,body,revision)values(p_slug,p_kind,p_body,rev);
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'save_content',p_slug);
end$$;
create function public.admin_unpublish_content(p_slug text) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 perform pg_advisory_xact_lock(hashtext(p_slug));update public.public_content set published=false where slug=p_slug;
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'unpublish_content',p_slug);
end$$;
create function public.asset_access(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.is_admin() and not exists(select 1 from public.public_content c where published and ((c.body->'items') @> jsonb_build_array(jsonb_build_object('asset_id',p_id::text)) or (c.body->'sections') @> jsonb_build_array(jsonb_build_object('asset_id',p_id::text)))) then return null;end if;
 return (select to_jsonb(a) from public.public_assets a where id=p_id);
end$$;
create function public.admin_settings(p_accounts int,p_quota bigint,p_emails int) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 update public.service_settings set beta_accounts=p_accounts,default_quota=p_quota,daily_email_limit=p_emails where singleton;
 insert into public.admin_audit(actor,action)values(auth.uid(),'service_settings');
end$$;
create function public.admin_health() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from public.service_settings s where singleton),'health',coalesce((select jsonb_agg(h) from public.service_health h),'[]'::jsonb),'email_attempts_today',coalesce((select attempts from public.email_budget where day=(now() at time zone 'UTC')::date),0),'exhausted_jobs',(select count(*) from public.notification_jobs where status='failed' and attempts>=5),'overdue_jobs',(select count(*) from public.notification_jobs where status in ('pending','failed') and due_at<now()-interval '5 minutes'),'deletions_pending',(select count(*) from public.account_deletions),'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'used_bytes',public.account_usage(p.id),'quota_bytes',p.quota_bytes,'near_quota',public.account_usage(p.id)>=p.quota_bytes*0.8)) from public.profiles p),'[]'::jsonb));
end$$;
create or replace function public.admin_retry_job(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 update public.notification_jobs j set status='pending',attempts=0,due_at=now(),claim_token=null where id=p_id and status='failed' and exists(select 1 from public.letters l where l.id=j.letter_id and l.status<>'cancelled' and (j.kind='release' or l.opens_at>now()));
 if not found then raise exception 'Job is not eligible for retry';end if;
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'retry_notification',p_id::text);
end$$;
revoke all on function public.release_due_letters(),public.prepare_notification(uuid,uuid),public.finish_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.release_due_letters(),public.prepare_notification(uuid,uuid),public.finish_notification(uuid,uuid,text) to service_role;
revoke all on function public.begin_account_deletion(),public.account_export(bigint),public.admin_unpublish_content(text),public.admin_settings(int,bigint,int),public.admin_health() from public,anon;
grant execute on function public.begin_account_deletion(),public.account_export(bigint),public.admin_unpublish_content(text),public.admin_settings(int,bigint,int),public.admin_health() to authenticated;
revoke all on function public.asset_access(uuid) from public;grant execute on function public.asset_access(uuid) to anon,authenticated;
revoke all on function public.valid_public_body(jsonb,text),public.job_schedule_default() from public,anon,authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
