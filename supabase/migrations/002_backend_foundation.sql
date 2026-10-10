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
