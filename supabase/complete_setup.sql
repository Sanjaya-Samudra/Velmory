-- ==============================================================================
-- VELMORY ALL-IN-ONE DATABASE SETUP
-- Migrations 001 - 012 + Email Signup Gate + Scheduler & Vault Secrets
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- Migration: 001_velmory.sql
-- ------------------------------------------------------------------------------
-- Velmory encrypted storage. Apply through Supabase migrations, never from a browser.
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text not null,status text not null default 'active' check(status in ('active','suspended')),quota_bytes bigint not null default 20971520 check(quota_bytes between 1048576 and 1073741824),email_notifications boolean not null default true,created_at timestamptz not null default now());
create table public.user_roles(user_id uuid primary key references auth.users(id) on delete cascade,role text not null check(role='admin'));
create table public.vaults(owner_id uuid primary key references auth.users(id) on delete cascade,envelope jsonb not null,public_key text not null,created_at timestamptz not null default now(),check(envelope->>'v'='1' and envelope->>'publicKey'=public_key));
create table public.documents(owner_id uuid not null references auth.users(id) on delete cascade,id text not null,envelope jsonb not null,revision bigint not null default 1,deleted boolean not null default false,updated_at timestamptz not null default now(),primary key(owner_id,id),check(envelope->>'v'='1' and jsonb_typeof(envelope->'ciphertext')='string'));
create index documents_changed on public.documents(owner_id,updated_at);
create table public.contacts(id uuid primary key default gen_random_uuid(),sender_id uuid not null references auth.users(id) on delete cascade,recipient_id uuid not null references auth.users(id) on delete cascade,status text not null default 'pending' check(status in ('pending','accepted','blocked')),created_at timestamptz not null default now(),check(sender_id<>recipient_id),unique(sender_id,recipient_id));
create table public.letters(id uuid primary key,sender_id uuid not null references auth.users(id) on delete cascade,recipient_id uuid not null references auth.users(id) on delete cascade,opens_at timestamptz not null,timezone text not null,status text not null default 'sealed' check(status in ('sealed','released','cancelled')),created_at timestamptz not null default now());
create table public.letter_secrets(letter_id uuid primary key references public.letters(id) on delete cascade,payload jsonb not null,wrapped_key text not null,recipient_key text not null);
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,letter_id uuid references public.letters(id) on delete cascade,kind text not null,created_at timestamptz not null default now(),read_at timestamptz,unique(user_id,letter_id,kind));
create table public.notification_jobs(id uuid primary key default gen_random_uuid(),letter_id uuid references public.letters(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,kind text not null check(kind in ('reminder','release')),due_at timestamptz not null,status text not null default 'pending' check(status in ('pending','processing','sent','failed','cancelled')),attempts int not null default 0,locked_at timestamptz,last_error text,unique(letter_id,user_id,kind));
create index jobs_due on public.notification_jobs(status,due_at);
create table public.public_content(id uuid primary key default gen_random_uuid(),slug text not null,kind text not null check(kind in ('announcement','cover','sticker','page')),body jsonb not null,revision int not null,published boolean not null default false,created_at timestamptz not null default now(),unique(slug,revision));
create unique index one_published_revision on public.public_content(slug) where published;
create table public.admin_audit(id uuid primary key default gen_random_uuid(),actor uuid references auth.users(id) on delete set null,action text not null,target_id text,created_at timestamptz not null default now());

create function public.active_user() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active')$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$select public.active_user() and coalesce(auth.jwt()->>'aal','')='aal2' and exists(select 1 from public.user_roles where user_id=auth.uid() and role='admin')$$;
create function public.new_account() returns trigger language plpgsql security definer set search_path='' as $$begin perform pg_advisory_xact_lock(5876421); if (select count(*) from public.profiles)>=25 then raise exception 'The current beta is full. Please try again later.';end if;insert into public.profiles(id,email) values(new.id,coalesce(new.email,''));return new;end$$;
create trigger account_created after insert on auth.users for each row execute function public.new_account();

alter table public.profiles enable row level security;alter table public.user_roles enable row level security;alter table public.vaults enable row level security;alter table public.documents enable row level security;alter table public.contacts enable row level security;alter table public.letters enable row level security;alter table public.letter_secrets enable row level security;alter table public.notifications enable row level security;alter table public.notification_jobs enable row level security;alter table public.public_content enable row level security;alter table public.admin_audit enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid());
create policy profile_preference on public.profiles for update to authenticated using(id=auth.uid() and public.active_user()) with check(id=auth.uid());
revoke all on public.profiles from authenticated;grant select on public.profiles to authenticated;grant update(email_notifications) on public.profiles to authenticated;
create policy own_vault_read on public.vaults for select to authenticated using(owner_id=auth.uid() and public.active_user());
create policy own_vault_create on public.vaults for insert to authenticated with check(owner_id=auth.uid() and public.active_user() and octet_length(envelope::text)<16384);
grant select,insert on public.vaults to authenticated;revoke update,delete on public.vaults from authenticated;
create policy own_documents on public.documents for select to authenticated using(owner_id=auth.uid() and public.active_user());
grant select on public.documents to authenticated;revoke insert,update,delete on public.documents from authenticated;
create policy participant_letters on public.letters for select to authenticated using((sender_id=auth.uid() or recipient_id=auth.uid()) and public.active_user());grant select on public.letters to authenticated;revoke insert,update,delete on public.letters from authenticated;
create policy own_notifications on public.notifications for select to authenticated using(user_id=auth.uid() and public.active_user());grant select on public.notifications to authenticated;
create policy published_content on public.public_content for select using(published);grant select on public.public_content to anon,authenticated;
revoke all on public.user_roles,public.contacts,public.letter_secrets,public.notification_jobs,public.admin_audit from anon,authenticated;

create function public.save_document(p_id text,p_expected_revision bigint,p_envelope jsonb,p_deleted boolean default false) returns bigint language plpgsql security definer set search_path='' as $$declare current_row public.documents;allowed bigint;used bigint;result bigint;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_deleted is null or p_id is null or p_envelope is null or p_id !~ '^(diary|letter|settings):' or length(p_id)>120 or p_envelope->>'v' is distinct from '1' or jsonb_typeof(p_envelope->'ciphertext') is distinct from 'string' or jsonb_typeof(p_envelope->'nonce') is distinct from 'string' then raise exception 'Invalid encrypted document';end if;
 select quota_bytes into allowed from public.profiles where id=auth.uid() for update;
 select * into current_row from public.documents where owner_id=auth.uid() and id=p_id;
 if found and current_row.envelope=p_envelope and current_row.deleted=p_deleted then return current_row.revision;end if;
 if coalesce(current_row.revision,0)<>p_expected_revision then raise exception 'revision_conflict';end if;
 select coalesce(sum(octet_length(envelope::text)),0) into used from public.documents where owner_id=auth.uid() and id<>p_id;
 if used+octet_length(p_envelope::text)>allowed then raise exception 'Storage allowance reached. Export or remove media before continuing.';end if;
 result:=coalesce(current_row.revision,0)+1;
 insert into public.documents(owner_id,id,envelope,revision,deleted) values(auth.uid(),p_id,p_envelope,result,p_deleted) on conflict(owner_id,id) do update set envelope=excluded.envelope,revision=excluded.revision,deleted=excluded.deleted,updated_at=clock_timestamp();return result;
end$$;

create function public.invite_contact(p_email text) returns void language plpgsql security definer set search_path='' as $$declare recipient uuid;begin if not public.active_user() then raise exception 'Account unavailable';end if;if (select count(*) from public.contacts where sender_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Daily invitation limit reached';end if;select p.id into recipient from public.profiles p join public.vaults v on p.id=v.owner_id where lower(p.email)=lower(trim(p_email)) and p.status='active';if recipient is null or recipient=auth.uid() then return;end if;if exists(select 1 from public.contacts where (sender_id=auth.uid() and recipient_id=recipient) or (sender_id=recipient and recipient_id=auth.uid())) then return;end if;insert into public.contacts(sender_id,recipient_id)values(auth.uid(),recipient);end$$;
create function public.list_contacts() returns table(id uuid,email text,public_key text,status text,direction text,invitation_id uuid) language sql stable security definer set search_path='' as $$select p.id,p.email,case when c.status='accepted' then v.public_key else '' end,c.status,case when c.sender_id=auth.uid() then 'outgoing' else 'incoming' end,c.id from public.contacts c join public.profiles p on p.id=case when c.sender_id=auth.uid() then c.recipient_id else c.sender_id end join public.vaults v on v.owner_id=p.id where (c.sender_id=auth.uid() or c.recipient_id=auth.uid()) and public.active_user()$$;
create function public.accept_contact(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin if not public.active_user() then raise exception 'Account unavailable';end if;update public.contacts set status='accepted' where id=p_id and recipient_id=auth.uid() and status='pending';if not found then raise exception 'Invitation unavailable';end if;end$$;
create function public.block_contact(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin if not public.active_user() then raise exception 'Account unavailable';end if;update public.contacts set status='blocked' where id=p_id and (sender_id=auth.uid() or recipient_id=auth.uid());end$$;
create function public.seal_letter(p_id uuid,p_recipient uuid,p_opens_at timestamptz,p_timezone text,p_payload jsonb,p_wrapped_key text,p_recipient_key text) returns void language plpgsql security definer set search_path='' as $$declare actual_key text;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;perform 1 from public.profiles where id=auth.uid() for update;
 if p_opens_at<=now() or p_opens_at>now()+interval '100 years' then raise exception 'Choose a valid future opening date';end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone';end if;
 if (select count(*) from public.letters where sender_id=auth.uid() and created_at>now()-interval '1 day')>=5 then raise exception 'Daily letter limit reached';end if;
 if p_recipient<>auth.uid() and not exists(select 1 from public.contacts where status='accepted' and ((sender_id=auth.uid() and recipient_id=p_recipient) or (recipient_id=auth.uid() and sender_id=p_recipient))) then raise exception 'Recipient must accept your invitation first';end if;
 select v.public_key into actual_key from public.vaults v join public.profiles p on p.id=v.owner_id where v.owner_id=p_recipient and p.status='active';
 if actual_key is null or actual_key<>p_recipient_key then raise exception 'Recipient key changed. Refresh and confirm the recipient again.';end if;
 if octet_length(p_payload::text)>100000 or length(p_wrapped_key)>512 or p_payload->>'v'<>'1' then raise exception 'Invalid letter payload';end if;
 insert into public.letters(id,sender_id,recipient_id,opens_at,timezone)values(p_id,auth.uid(),p_recipient,p_opens_at,p_timezone);
 insert into public.letter_secrets values(p_id,p_payload,p_wrapped_key,p_recipient_key);
 insert into public.notification_jobs(letter_id,user_id,kind,due_at)values(p_id,p_recipient,'release',p_opens_at);
 if p_opens_at>now()+interval '24 hours' then insert into public.notification_jobs(letter_id,user_id,kind,due_at)values(p_id,p_recipient,'reminder',p_opens_at-interval '24 hours');end if;
end$$;
create function public.cancel_letter(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin if not public.active_user() then raise exception 'Account unavailable';end if;perform 1 from public.letters where id=p_id and sender_id=auth.uid() for update;if not found then raise exception 'Letter unavailable';end if;update public.letters set status='cancelled' where id=p_id;update public.notification_jobs set status='cancelled' where letter_id=p_id and status<>'sent';delete from public.letter_secrets where letter_id=p_id;end$$;
create function public.open_letter(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare letter public.letters;secret public.letter_secrets;begin if not public.active_user() then raise exception 'Account unavailable';end if;select * into letter from public.letters where id=p_id and recipient_id=auth.uid() for update;if not found or letter.status='cancelled' or letter.opens_at>now() then raise exception 'This letter is not available to open';end if;select * into secret from public.letter_secrets where letter_id=p_id;if not found then raise exception 'Letter unavailable';end if;update public.letters set status='released' where id=p_id;return jsonb_build_object('payload',secret.payload,'wrapped_key',secret.wrapped_key);end$$;

create function public.claim_notification_jobs() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 update public.letters set status='released' where status='sealed' and opens_at<=now();
 insert into public.notifications(user_id,letter_id,kind) select user_id,letter_id,kind from public.notification_jobs j where due_at<=now() and status not in ('cancelled') and exists(select 1 from public.letters l where l.id=j.letter_id and l.status<>'cancelled') on conflict do nothing;
 update public.notification_jobs set status='pending' where status='processing' and locked_at<now()-interval '10 minutes';
 with picked as(select j.id from public.notification_jobs j join public.profiles p on p.id=j.user_id join public.letters l on l.id=j.letter_id where j.status in ('pending','failed') and j.attempts<5 and j.due_at<=now() and l.status<>'cancelled' and p.status='active' order by j.due_at for update of j skip locked limit 20),claimed as(update public.notification_jobs j set status='processing',attempts=attempts+1,locked_at=now() from picked where j.id=picked.id returning j.*) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'letter_id',c.letter_id,'email',p.email,'enabled',p.email_notifications)), '[]'::jsonb) into result from claimed c join public.profiles p on p.id=c.user_id;
 return result;
end$$;
revoke all on function public.claim_notification_jobs() from public,anon,authenticated;grant execute on function public.claim_notification_jobs() to service_role;

create function public.admin_overview() returns jsonb language plpgsql security definer set search_path='' as $$begin if not public.is_admin() then raise exception 'An administrator role and verified authenticator session are required';end if;return jsonb_build_object('profiles',(select coalesce(jsonb_agg(p),'[]')from public.profiles p),'content',(select coalesce(jsonb_agg(c),'[]')from public.public_content c),'jobs',(select coalesce(jsonb_agg(j),'[]')from (select id,kind,status,attempts,due_at from public.notification_jobs order by due_at desc limit 100)j),'audit',(select coalesce(jsonb_agg(a),'[]')from (select * from public.admin_audit order by created_at desc limit 100)a));end$$;
create function public.admin_account(p_id uuid,p_status text,p_quota bigint) returns void language plpgsql security definer set search_path='' as $$begin if not public.is_admin() then raise exception 'Administrator verification required';end if;if p_id=auth.uid() and p_status='suspended' then raise exception 'Cannot suspend your current administrator account';end if;update public.profiles set status=p_status,quota_bytes=p_quota where id=p_id;insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'account_update',p_id::text);end$$;
create function public.admin_save_content(p_slug text,p_body jsonb,p_kind text) returns void language plpgsql security definer set search_path='' as $$declare rev int;begin if not public.is_admin() then raise exception 'Administrator verification required';end if;if p_slug!~'^[a-z0-9-]{1,80}$' or octet_length(p_body::text)>10000 or jsonb_typeof(p_body)<>'object' then raise exception 'Invalid content';end if;perform pg_advisory_xact_lock(hashtext(p_slug));select coalesce(max(revision),0)+1 into rev from public.public_content where slug=p_slug;insert into public.public_content(slug,kind,body,revision)values(p_slug,p_kind,p_body,rev);insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'save_content',p_slug);end$$;
create function public.admin_publish_content(p_id uuid) returns void language plpgsql security definer set search_path='' as $$declare content_slug text;begin if not public.is_admin() then raise exception 'Administrator verification required';end if;select slug into content_slug from public.public_content where id=p_id;if content_slug is null then raise exception 'Content not found';end if;perform pg_advisory_xact_lock(hashtext(content_slug));update public.public_content set published=false where slug=content_slug;update public.public_content set published=true where id=p_id;insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'publish_content',p_id::text);end$$;
create function public.admin_retry_job(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin if not public.is_admin() then raise exception 'Administrator verification required';end if;update public.notification_jobs set status='pending',attempts=0 where id=p_id and status='failed';insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'retry_notification',p_id::text);end$$;

-- Explicit function grants; PostgreSQL grants execution to PUBLIC by default.
revoke all on function public.save_document(text,bigint,jsonb,boolean),public.invite_contact(text),public.list_contacts(),public.accept_contact(uuid),public.block_contact(uuid),public.seal_letter(uuid,uuid,timestamptz,text,jsonb,text,text),public.cancel_letter(uuid),public.open_letter(uuid),public.admin_overview(),public.admin_account(uuid,text,bigint),public.admin_save_content(text,jsonb,text),public.admin_publish_content(uuid),public.admin_retry_job(uuid) from public,anon;
grant execute on function public.save_document(text,bigint,jsonb,boolean),public.invite_contact(text),public.list_contacts(),public.accept_contact(uuid),public.block_contact(uuid),public.seal_letter(uuid,uuid,timestamptz,text,jsonb,text,text),public.cancel_letter(uuid),public.open_letter(uuid),public.admin_overview(),public.admin_account(uuid,text,bigint),public.admin_save_content(text,jsonb,text),public.admin_publish_content(uuid),public.admin_retry_job(uuid) to authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 002_backend_foundation.sql
-- ------------------------------------------------------------------------------
-- Additive backend completion. Apply after 001; existing clients remain compatible.
alter table public.profiles drop constraint profiles_status_check;
alter table public.profiles add constraint profiles_status_check check(status in ('active','suspended','deleting'));
alter table public.profiles add column sync_revision bigint not null default 0;
alter table public.documents add column change_seq bigint not null default 0;
alter table public.vaults add column revision bigint not null default 1;
create table public.service_settings(singleton boolean primary key default true check(singleton),beta_accounts int not null default 25 check(beta_accounts between 1 and 100000),default_quota bigint not null default 20971520 check(default_quota between 1048576 and 1073741824),daily_email_limit int not null default 280 check(daily_email_limit between 1 and 100000));
insert into public.service_settings(singleton) values(true);
create table public.rate_windows(owner_id uuid not null references auth.users(id) on delete cascade,action text not null,day date not null default (now() at time zone 'UTC')::date,used int not null default 0,primary key(owner_id,action,day));
alter table public.service_settings enable row level security;
alter table public.rate_windows enable row level security;
revoke all on public.service_settings,public.rate_windows from anon,authenticated;
create function public.consume_rate(p_action text,p_limit int) returns void language plpgsql security definer set search_path='' as $$declare n int;begin
 insert into public.rate_windows(owner_id,action,used) values(auth.uid(),p_action,1) on conflict(owner_id,action,day) do update set used=public.rate_windows.used+1 returning used into n;
 if n>p_limit then raise exception 'Daily operation limit reached';end if;
end$$;
revoke all on function public.consume_rate(text,int) from public,anon,authenticated;
create or replace function public.new_account() returns trigger language plpgsql security definer set search_path='' as $$declare cfg public.service_settings;begin
 perform pg_advisory_xact_lock(5876421);select * into cfg from public.service_settings where singleton;
 if (select count(*) from public.profiles)>=cfg.beta_accounts then raise exception 'The current beta is full. Please try again later.';end if;
 insert into public.profiles(id,email,quota_bytes) values(new.id,coalesce(new.email,''),cfg.default_quota);return new;
end$$;
create function public.account_email_changed() returns trigger language plpgsql security definer set search_path='' as $$begin update public.profiles set email=coalesce(new.email,'') where id=new.id;return new;end$$;
create trigger account_email_updated after update of email on auth.users for each row execute function public.account_email_changed();
create function public.document_sequence() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.profiles set sync_revision=sync_revision+1 where id=new.owner_id returning sync_revision into new.change_seq;return new;
end$$;
create trigger assign_document_sequence before insert or update on public.documents for each row execute function public.document_sequence();
update public.documents set revision=revision; -- assigns a cursor to existing records
create index documents_cursor on public.documents(owner_id,change_seq);
create function public.fetch_changes(p_cursor bigint default 0,p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_cursor is null or p_cursor<0 or p_limit is null or p_limit not between 1 and 200 then raise exception 'Invalid cursor';end if;
 select jsonb_build_object('records',coalesce(jsonb_agg(r order by r.change_seq),'[]'::jsonb),'cursor',coalesce(max(r.change_seq),p_cursor),'has_more',count(*)=p_limit) into result from (select id,envelope,revision,deleted,updated_at,change_seq from public.documents where owner_id=auth.uid() and change_seq>p_cursor order by change_seq limit p_limit)r;
 return result;
end$$;
create function public.valid_cipher(p jsonb) returns boolean language sql immutable set search_path='' as $$select coalesce(jsonb_typeof(p)='object' and p->>'v'='1' and jsonb_typeof(p->'nonce')='string' and length(p->>'nonce') between 16 and 64 and jsonb_typeof(p->'ciphertext')='string' and length(p->>'ciphertext') between 20 and 12000000,false)$$;
-- Legacy test fixtures aside, all new writes must carry real authenticated envelopes.
create function public.rewrap_vault(p_expected_revision bigint,p_envelope jsonb) returns bigint language plpgsql security definer set search_path='' as $$declare v public.vaults;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 select * into v from public.vaults where owner_id=auth.uid() for update;
 if not found or p_expected_revision is distinct from v.revision then raise exception 'revision_conflict';end if;
 if octet_length(p_envelope::text)>16384 or p_envelope->>'v' is distinct from '1' or p_envelope->>'publicKey' is distinct from v.public_key or not public.valid_cipher(p_envelope->'pass') or not public.valid_cipher(p_envelope->'recovery') or p_envelope->>'ops' is distinct from '2' or p_envelope->>'mem' is distinct from '67108864' or length(coalesce(p_envelope->>'salt','')) not between 20 and 24 then raise exception 'Invalid key envelope';end if;
 update public.vaults set envelope=p_envelope,revision=revision+1 where owner_id=auth.uid() returning revision into v.revision;return v.revision;
end$$;
create or replace function public.invite_contact(p_email text) returns void language plpgsql security definer set search_path='' as $$declare recipient uuid;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_email is null or length(p_email)>254 or p_email!~'^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'Invalid email';end if;
 perform public.consume_rate('contact_invitation',10);
 select p.id into recipient from public.profiles p join public.vaults v on p.id=v.owner_id where lower(p.email)=lower(trim(p_email)) and p.status='active' limit 1;
 if recipient is null or recipient=auth.uid() then return;end if;
 perform pg_advisory_xact_lock(hashtextextended(least(auth.uid()::text,recipient::text)||greatest(auth.uid()::text,recipient::text),0));
 if exists(select 1 from public.contacts where (sender_id=auth.uid() and recipient_id=recipient) or (sender_id=recipient and recipient_id=auth.uid())) then return;end if;
 insert into public.contacts(sender_id,recipient_id)values(auth.uid(),recipient);
end$$;
create function public.resolve_recipient(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 if p_id<>auth.uid() and not exists(select 1 from public.contacts where status='accepted' and ((sender_id=auth.uid() and recipient_id=p_id) or (recipient_id=auth.uid() and sender_id=p_id))) then raise exception 'Recipient unavailable';end if;
 select jsonb_build_object('id',p.id,'public_key',v.public_key,'revision',v.revision) into result from public.profiles p join public.vaults v on v.owner_id=p.id where p.id=p_id and p.status='active';
 if result is null then raise exception 'Recipient unavailable';end if;return result;
end$$;
create function public.mark_notification_read(p_id uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not public.active_user() then raise exception 'Account unavailable';end if;
 update public.notifications set read_at=coalesce(read_at,now()) where id=p_id and user_id=auth.uid();
end$$;
revoke all on function public.fetch_changes(bigint,int),public.rewrap_vault(bigint,jsonb),public.resolve_recipient(uuid),public.mark_notification_read(uuid) from public,anon;
grant execute on function public.fetch_changes(bigint,int),public.rewrap_vault(bigint,jsonb),public.resolve_recipient(uuid),public.mark_notification_read(uuid) to authenticated;
revoke all on function public.account_email_changed(),public.document_sequence(),public.new_account() from public,anon,authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 003_private_media.sql
-- ------------------------------------------------------------------------------
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


-- ------------------------------------------------------------------------------
-- Migration: 004_operations_and_content.sql
-- ------------------------------------------------------------------------------
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


-- ------------------------------------------------------------------------------
-- Migration: 005_backend_hardening.sql
-- ------------------------------------------------------------------------------
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


-- ------------------------------------------------------------------------------
-- Migration: 006_launch_controls.sql
-- ------------------------------------------------------------------------------
alter table public.service_settings add column maintenance boolean not null default false;
alter table public.service_settings add column email_signup_enabled boolean not null default false;
create or replace function public.active_user() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active') and not exists(select 1 from public.service_settings where maintenance)$$;
create or replace function public.new_account() returns trigger language plpgsql security definer set search_path='' as $$declare cfg public.service_settings;provider text;begin
 perform pg_advisory_xact_lock(5876421);select * into cfg from public.service_settings where singleton;
 if cfg.maintenance then raise exception 'Service maintenance in progress';end if;
 provider:=coalesce(to_jsonb(new)->'raw_app_meta_data'->>'provider','email');
 if provider='email' and not cfg.email_signup_enabled then raise exception 'Email signup is not enabled';end if;
 if (select count(*) from public.profiles)>=cfg.beta_accounts then raise exception 'The current beta is full. Please try again later.';end if;
 insert into public.profiles(id,email,quota_bytes) values(new.id,coalesce(new.email,''),cfg.default_quota);return new;
end$$;
create function public.reject_maintenance_deletion() returns trigger language plpgsql security definer set search_path='' as $$begin if exists(select 1 from public.service_settings where maintenance) then raise exception 'Service maintenance in progress';end if;return new;end$$;
create trigger deletion_maintenance before insert on public.account_deletions for each row execute function public.reject_maintenance_deletion();
revoke all on function public.reject_maintenance_deletion() from public,anon,authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 007_explicit_grants.sql
-- ------------------------------------------------------------------------------
-- Supabase projects can have broader default privileges than plain PostgreSQL.
-- Reset table privileges before granting the exact client-facing surface.
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.vaults,public.documents,public.letters,public.notifications,public.public_content,public.media_objects to authenticated;
grant select on public.public_content to anon;
grant insert on public.vaults to authenticated;
grant update(email_notifications) on public.profiles to authenticated;
-- Restrictive policies remain effective even if another permissive storage policy
-- is installed later. Service-role operations bypass RLS in the Edge Functions.
create policy velmory_service_storage_only on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id not in ('velmory-private','velmory-artwork'))
 with check(bucket_id not in ('velmory-private','velmory-artwork'));


-- ------------------------------------------------------------------------------
-- Migration: 008_cleanup_leases.sql
-- ------------------------------------------------------------------------------
alter table public.media_objects add column cleanup_after timestamptz;
create function public.media_cleanup_grace() returns trigger language plpgsql set search_path='' as $$begin
 if new.state='deleting' and old.state is distinct from 'deleting' then new.cleanup_after:=now()+interval '15 minutes';end if;return new;
end$$;
create trigger media_deletion_grace before update on public.media_objects for each row execute function public.media_cleanup_grace();
update public.media_objects set cleanup_after=now()+interval '15 minutes' where state='deleting';
revoke all on function public.media_cleanup_grace() from public,anon,authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 009_artwork_audit.sql
-- ------------------------------------------------------------------------------
create function public.admin_register_artwork(p_id uuid,p_mime text,p_bytes int,p_sha256 text) returns void language plpgsql security definer set search_path='' as $$declare previous public.public_assets;begin
 if not public.is_admin() then raise exception 'Administrator verification required';end if;
 select * into previous from public.public_assets where id=p_id;
 if found then if previous.sha256 is distinct from p_sha256 or previous.mime is distinct from p_mime or previous.bytes is distinct from p_bytes then raise exception 'Artwork is immutable';end if;return;end if;
 insert into public.public_assets(id,path,mime,bytes,sha256,created_by)values(p_id,p_id::text||'/'||p_sha256,p_mime,p_bytes,p_sha256,auth.uid());
 insert into public.admin_audit(actor,action,target_id)values(auth.uid(),'artwork_upload',p_id::text);
end$$;
revoke all on function public.admin_register_artwork(uuid,text,int,text) from public,anon;
grant execute on function public.admin_register_artwork(uuid,text,int,text) to authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 010_delete_cancelled_letters.sql
-- ------------------------------------------------------------------------------
-- A sender may permanently remove a cancelled delivery after revocation.
-- Media cleanup retains its existing grace period so storage can be reclaimed safely.
create function public.delete_cancelled_letter(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare letter public.letters;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  select * into letter from public.letters where id=p_id for update;
  if not found or letter.sender_id<>auth.uid() or letter.status<>'cancelled' then
    raise exception 'Only the sender can delete a cancelled letter';
  end if;
  update public.media_objects set state='deleting'
    where letter_id=p_id and owner_id=auth.uid() and state<>'deleting';
  delete from public.letters where id=p_id;
end$$;

revoke all on function public.delete_cancelled_letter(uuid) from public,anon;
grant execute on function public.delete_cancelled_letter(uuid) to authenticated;


-- ------------------------------------------------------------------------------
-- Migration: 011_page_documents.sql
-- ------------------------------------------------------------------------------
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


-- ------------------------------------------------------------------------------
-- Migration: 012_shared_diaries.sql
-- ------------------------------------------------------------------------------
-- Shared diaries: collaborative diary spaces where multiple users co-author encrypted pages.
-- Each member holds their own wrapped copy of the shared content key (asymmetric, like letters).

create table public.shared_diaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(length(title) between 1 and 150),
  cover text not null default 'navy' check(cover in ('navy','forest','burgundy','charcoal','rose')),
  milestone_date date,
  milestone_label text check(milestone_label is null or length(milestone_label) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.shared_diary_members (
  id uuid primary key default gen_random_uuid(),
  diary_id uuid not null references public.shared_diaries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'editor' check(role in ('owner','editor')),
  wrapped_key text not null, -- shared content key sealed for this user's vault public key
  recipient_key text not null, -- the vault public key used to seal (for key rotation detection)
  status text not null default 'pending' check(status in ('pending','active','removed')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  unique(diary_id, user_id)
);

create table public.shared_diary_pages (
  id bigint generated always as identity primary key,
  diary_id uuid not null references public.shared_diaries(id) on delete cascade,
  page_id text not null check(page_id ~ '^[a-zA-Z0-9-]{1,80}$'),
  author_id uuid references auth.users(id) on delete set null,
  envelope jsonb not null check(envelope->>'v'='1' and jsonb_typeof(envelope->'ciphertext')='string'),
  revision bigint not null default 1 check(revision >= 1),
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  unique(diary_id, page_id)
);

create index shared_pages_cursor on public.shared_diary_pages(diary_id, id);

alter table public.shared_diaries enable row level security;
alter table public.shared_diary_members enable row level security;
alter table public.shared_diary_pages enable row level security;

-- Helper security-definer checks to break any mutual RLS recursion between diaries and members
create function public.is_shared_diary_owner(p_diary_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.shared_diaries where id=p_diary_id and owner_id=auth.uid());
$$;

create function public.is_shared_diary_member(p_diary_id uuid, p_active_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.shared_diary_members
    where diary_id=p_diary_id and user_id=auth.uid()
      and (case when p_active_only then status='active' else status in ('pending','active') end)
  );
$$;

revoke all on function public.is_shared_diary_owner(uuid), public.is_shared_diary_member(uuid, boolean) from public, anon;
grant execute on function public.is_shared_diary_owner(uuid), public.is_shared_diary_member(uuid, boolean) to authenticated;

-- RLS: members can see diaries they belong to or own
create policy shared_diary_member_select on public.shared_diaries
  for select to authenticated
  using(public.active_user() and (owner_id=auth.uid() or public.is_shared_diary_member(id, false)));

-- RLS: members and owner can see membership
create policy shared_member_select on public.shared_diary_members
  for select to authenticated
  using(public.active_user() and (user_id=auth.uid() or public.is_shared_diary_owner(diary_id)));

-- RLS: active members can see pages
create policy shared_page_select on public.shared_diary_pages
  for select to authenticated
  using(public.active_user() and public.is_shared_diary_member(diary_id, true));

revoke all on public.shared_diaries,public.shared_diary_members,public.shared_diary_pages from anon,authenticated;
grant select on public.shared_diaries,public.shared_diary_members,public.shared_diary_pages to authenticated;

-- Create a shared diary (owner only)
create function public.create_shared_diary(
  p_title text,
  p_cover text,
  p_wrapped_key text,
  p_recipient_key text,
  p_milestone_date date default null,
  p_milestone_label text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare diary_id uuid;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  perform public.consume_rate('create_shared_diary', 20);
  if length(p_title) not between 1 and 150 then raise exception 'Invalid title'; end if;
  if p_cover not in ('navy','forest','burgundy','charcoal','rose') then raise exception 'Invalid cover'; end if;
  if length(p_wrapped_key) > 512 or length(p_recipient_key) > 256 then raise exception 'Invalid key material'; end if;
  if p_milestone_label is not null and length(p_milestone_label) not between 1 and 100 then raise exception 'Invalid milestone label'; end if;
  if (select count(*) from public.shared_diaries where owner_id=auth.uid()) >= 20
    then raise exception 'Shared diary limit reached'; end if;
  insert into public.shared_diaries(owner_id, title, cover, milestone_date, milestone_label)
    values(auth.uid(), p_title, p_cover, p_milestone_date, p_milestone_label)
    returning id into diary_id;
  insert into public.shared_diary_members(diary_id, user_id, role, wrapped_key, recipient_key, status, joined_at)
    values(diary_id, auth.uid(), 'owner', p_wrapped_key, p_recipient_key, 'active', now());
  return diary_id;
end$$;

-- Invite a contact to a shared diary (owner only)
create function public.invite_shared_member(
  p_diary_id uuid,
  p_user_id uuid,
  p_wrapped_key text,
  p_recipient_key text
) returns void language plpgsql security definer set search_path='' as $$
declare actual_key text;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  perform public.consume_rate('invite_shared_member', 30);
  if not exists(select 1 from public.shared_diaries where id=p_diary_id and owner_id=auth.uid())
    then raise exception 'Diary unavailable or you are not the owner'; end if;
  if not exists(select 1 from public.contacts where status='accepted'
    and ((sender_id=auth.uid() and recipient_id=p_user_id) or (recipient_id=auth.uid() and sender_id=p_user_id)))
    then raise exception 'This person must be an accepted contact first'; end if;
  select v.public_key into actual_key from public.vaults v join public.profiles p on p.id=v.owner_id
    where v.owner_id=p_user_id and p.status='active';
  if actual_key is null or actual_key<>p_recipient_key then raise exception 'Recipient key changed. Refresh and confirm the recipient again.'; end if;
  if length(p_wrapped_key) > 512 then raise exception 'Invalid key material'; end if;
  if (select count(*) from public.shared_diary_members where diary_id=p_diary_id and status<>'removed') >= 10
    then raise exception 'Member limit reached (10 per shared diary)'; end if;
  insert into public.shared_diary_members(diary_id, user_id, role, wrapped_key, recipient_key, status)
    values(p_diary_id, p_user_id, 'editor', p_wrapped_key, p_recipient_key, 'pending')
    on conflict(diary_id, user_id) do update
      set wrapped_key=excluded.wrapped_key, recipient_key=excluded.recipient_key, status='pending', invited_at=now(), joined_at=null;
end$$;

-- Accept invitation to join a shared diary
create function public.accept_shared_invite(p_diary_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  update public.shared_diary_members
    set status='active', joined_at=now()
    where diary_id=p_diary_id and user_id=auth.uid() and status='pending';
  if not found then raise exception 'Invitation unavailable'; end if;
end$$;

-- Decline or leave a shared diary (member removes themselves; owner can remove others)
create function public.remove_shared_member(p_diary_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if auth.uid() <> p_user_id and not exists(
    select 1 from public.shared_diaries where id=p_diary_id and owner_id=auth.uid()
  ) then raise exception 'Permission denied'; end if;
  if p_user_id = (select owner_id from public.shared_diaries where id=p_diary_id)
    and auth.uid() = p_user_id
    then raise exception 'Transfer ownership or delete the diary instead'; end if;
  update public.shared_diary_members set status='removed'
    where diary_id=p_diary_id and user_id=p_user_id;
end$$;

-- Delete a shared diary (owner only)
create function public.delete_shared_diary(p_diary_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if not exists(select 1 from public.shared_diaries where id=p_diary_id and owner_id=auth.uid())
    then raise exception 'Diary unavailable or you are not the owner'; end if;
  delete from public.shared_diaries where id=p_diary_id;
end$$;

-- Update milestone date / label for a shared diary (active members can update)
create function public.update_shared_diary_milestone(
  p_diary_id uuid,
  p_milestone_date date,
  p_milestone_label text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if not exists(select 1 from public.shared_diary_members where diary_id=p_diary_id and user_id=auth.uid() and status='active')
    then raise exception 'Not a member of this shared diary'; end if;
  if p_milestone_label is not null and length(p_milestone_label) not between 1 and 100
    then raise exception 'Invalid milestone label'; end if;
  update public.shared_diaries
    set milestone_date=p_milestone_date, milestone_label=p_milestone_label
    where id=p_diary_id;
end$$;

-- Save a shared diary page (active members only)
create function public.save_shared_page(
  p_diary_id uuid,
  p_page_id text,
  p_expected_revision bigint,
  p_envelope jsonb,
  p_deleted boolean default false
) returns bigint language plpgsql security definer set search_path='' as $$
declare old public.shared_diary_pages; result bigint;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  perform public.consume_rate('save_shared_page', 300);
  if not exists(select 1 from public.shared_diary_members
    where diary_id=p_diary_id and user_id=auth.uid() and status='active')
    then raise exception 'Not a member of this shared diary'; end if;
  if p_page_id is null or p_page_id !~ '^[a-zA-Z0-9-]{1,80}$'
    or not public.valid_cipher(p_envelope)
    or octet_length(p_envelope::text) > 200000
    then raise exception 'Invalid page data'; end if;
  if p_expected_revision is null or p_expected_revision < 0
    then raise exception 'Invalid revision'; end if;
  select * into old from public.shared_diary_pages
    where diary_id=p_diary_id and page_id=p_page_id;
  if found and old.envelope=p_envelope and old.deleted=p_deleted then return old.revision; end if;
  if coalesce(old.revision,0) <> p_expected_revision then raise exception 'revision_conflict'; end if;
  result := coalesce(old.revision,0)+1;
  insert into public.shared_diary_pages(diary_id, page_id, author_id, envelope, revision, deleted)
    values(p_diary_id, p_page_id, auth.uid(), p_envelope, result, p_deleted)
    on conflict(diary_id, page_id) do update
      set envelope=excluded.envelope, revision=excluded.revision,
          deleted=excluded.deleted, author_id=excluded.author_id,
          updated_at=clock_timestamp();
  return result;
end$$;

-- Fetch shared diary pages since a cursor (for sync)
create function public.fetch_shared_pages(p_diary_id uuid, p_cursor bigint default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if not exists(select 1 from public.shared_diary_members
    where diary_id=p_diary_id and user_id=auth.uid() and status='active')
    then raise exception 'Not a member of this shared diary'; end if;
  if p_cursor is null or p_cursor < 0 or p_limit is null or p_limit not between 1 and 200
    then raise exception 'Invalid cursor'; end if;

  select jsonb_build_object(
    'pages', coalesce(jsonb_agg(jsonb_build_object(
      'page_id', r.page_id,
      'author_id', r.author_id,
      'envelope', r.envelope,
      'revision', r.revision,
      'deleted', r.deleted,
      'updated_at', r.updated_at
    ) order by r.id), '[]'::jsonb),
    'cursor', coalesce(max(r.id), p_cursor),
    'has_more', count(*) = p_limit
  ) into result
  from (
    select id, page_id, author_id, envelope, revision, deleted, updated_at
    from public.shared_diary_pages
    where diary_id=p_diary_id and id > p_cursor
    order by id limit p_limit
  ) r;

  return result;
end$$;

-- List all shared diaries the current user is a member of
create function public.list_shared_diaries() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',d.id,'title',d.title,'cover',d.cover,'owner_id',d.owner_id,
      'milestone_date',d.milestone_date,'milestone_label',d.milestone_label,
      'created_at',d.created_at,
      'my_role',m.role,'my_wrapped_key',m.wrapped_key,'status',m.status,
      'members',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'user_id',m2.user_id,'email',p2.email,'role',m2.role,'status',m2.status,'joined_at',m2.joined_at
        )),'[]'::jsonb)
        from public.shared_diary_members m2
        join public.profiles p2 on p2.id=m2.user_id
        where m2.diary_id=d.id and m2.status <> 'removed'
      )
    ))
    from public.shared_diaries d
    join public.shared_diary_members m on m.diary_id=d.id and m.user_id=auth.uid() and m.status in ('pending','active')
  ),'[]'::jsonb);
end$$;

-- Safely add tables to supabase_realtime publication if enabled in environment
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.shared_diaries;
    alter publication supabase_realtime add table public.shared_diary_members;
    alter publication supabase_realtime add table public.shared_diary_pages;
  end if;
end $$;

revoke all on function
  public.create_shared_diary(text,text,text,text,date,text),
  public.invite_shared_member(uuid,uuid,text,text),
  public.accept_shared_invite(uuid),
  public.remove_shared_member(uuid,uuid),
  public.delete_shared_diary(uuid),
  public.update_shared_diary_milestone(uuid,date,text),
  public.save_shared_page(uuid,text,bigint,jsonb,boolean),
  public.fetch_shared_pages(uuid,bigint,int),
  public.list_shared_diaries()
from public,anon;
grant execute on function
  public.create_shared_diary(text,text,text,text,date,text),
  public.invite_shared_member(uuid,uuid,text,text),
  public.accept_shared_invite(uuid),
  public.remove_shared_member(uuid,uuid),
  public.delete_shared_diary(uuid),
  public.update_shared_diary_milestone(uuid,date,text),
  public.save_shared_page(uuid,text,bigint,jsonb,boolean),
  public.fetch_shared_pages(uuid,bigint,int),
  public.list_shared_diaries()
to authenticated;


-- ------------------------------------------------------------------------------
-- Enable Email Signup on Service Settings
-- ------------------------------------------------------------------------------
UPDATE public.service_settings 
SET email_signup_enabled = true 
WHERE singleton = true;

-- ------------------------------------------------------------------------------
-- Configure Vault Secrets for pg_cron scheduler
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS supabase_vault;

DELETE FROM vault.secrets WHERE name IN ('project_url', 'scheduler_secret');

SELECT vault.create_secret('https://kqypzgojpoccbojgsivm.supabase.co', 'project_url');
SELECT vault.create_secret('636ed77173054093a718b3a4d316c22477613041563edaa605447f51079d7867', 'scheduler_secret');

-- ------------------------------------------------------------------------------
-- Configure Background Jobs (pg_cron & pg_net)
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('velmory-letter-dispatch');
  PERFORM cron.unschedule('velmory-maintenance');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule('velmory-letter-dispatch', '* * * * *', $$
  SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/functions/v1/letter-dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='scheduler_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
$$);

SELECT cron.schedule('velmory-maintenance', '*/5 * * * *', $$
  SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')||'/functions/v1/maintenance',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='scheduler_secret')),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  );
$$);
