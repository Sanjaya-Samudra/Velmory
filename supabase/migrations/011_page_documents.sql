-- Version 2 diaries store metadata and each page as independent encrypted records.
-- Existing diary:<id> records remain readable and are migrated by the client.
create or replace function public.save_document(
 p_id text,p_expected_revision bigint,p_envelope jsonb,p_deleted boolean default false
) returns bigint language plpgsql security definer set search_path='' as $$
declare old public.documents;allowed bigint;used bigint;result bigint;
begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_deleted is null or p_id is null
    or p_id!~'^(diary|diary-meta|diary-page|letter|settings):[a-zA-Z0-9:-]{1,180}$'
    or not public.valid_cipher(p_envelope) then raise exception 'Invalid encrypted document';end if;
 select quota_bytes into allowed from public.profiles where id=auth.uid() for update;
 select * into old from public.documents where owner_id=auth.uid() and id=p_id;
 if found and old.envelope=p_envelope and old.deleted=p_deleted then return old.revision;end if;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception 'revision_conflict';end if;
 used:=public.account_usage(auth.uid())-coalesce(octet_length(old.envelope::text),0)+octet_length(p_envelope::text);
 if used>allowed then raise exception 'Storage allowance reached';end if;
 result:=coalesce(old.revision,0)+1;
 insert into public.documents(owner_id,id,envelope,revision,deleted)
 values(auth.uid(),p_id,p_envelope,result,p_deleted)
 on conflict(owner_id,id) do update set envelope=excluded.envelope,revision=excluded.revision,deleted=excluded.deleted,updated_at=clock_timestamp();
 return result;
end$$;

create or replace function public.admin_capability() returns boolean
language sql stable security definer set search_path='' as $$
 select public.active_user() and exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin')
$$;
revoke all on function public.admin_capability() from public,anon;
grant execute on function public.admin_capability() to authenticated;

create table public.operational_events(id bigint generated always as identity primary key,user_id uuid references auth.users(id) on delete set null,area text not null check(area in ('sync','media','archive','ui')),code text not null check(code~'^[a-z0-9_]{2,48}$'),duration_ms int check(duration_ms between 0 and 600000),created_at timestamptz not null default now());
alter table public.operational_events enable row level security;
revoke all on public.operational_events from anon,authenticated;
grant all on public.operational_events to service_role;
create function public.report_operational_event(p_area text,p_code text,p_duration int default null) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.active_user() or p_area not in ('sync','media','archive','ui') or p_code!~'^[a-z0-9_]{2,48}$' or (p_duration is not null and p_duration not between 0 and 600000) then raise exception 'Invalid operational event';end if;
 perform public.consume_rate('operational_event',60);insert into public.operational_events(user_id,area,code,duration_ms) values(auth.uid(),p_area,p_code,p_duration);
end$$;
revoke all on function public.report_operational_event(text,text,int) from public,anon;
grant execute on function public.report_operational_event(text,text,int) to authenticated;

create or replace function public.admin_health() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 return jsonb_build_object('settings',(select to_jsonb(s) from public.service_settings s where singleton),'health',coalesce((select jsonb_agg(h) from public.service_health h),'[]'::jsonb),'email_attempts_today',coalesce((select attempts from public.email_budget where day=(now() at time zone 'UTC')::date),0),'exhausted_jobs',(select count(*) from public.notification_jobs where status='failed' and attempts>=5),'overdue_jobs',(select count(*) from public.notification_jobs where status in ('pending','failed') and due_at<now()-interval '5 minutes'),'deletions_pending',(select count(*) from public.account_deletions),'client_failures_24h',(select count(*) from public.operational_events where created_at>now()-interval '24 hours'),'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'used_bytes',public.account_usage(p.id),'quota_bytes',p.quota_bytes,'near_quota',public.account_usage(p.id)>=p.quota_bytes*0.8)) from public.profiles p),'[]'::jsonb));
end$$;
