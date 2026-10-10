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
