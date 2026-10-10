alter table public.media_objects add column cleanup_after timestamptz;
create function public.media_cleanup_grace() returns trigger language plpgsql set search_path='' as $$begin
 if new.state='deleting' and old.state is distinct from 'deleting' then new.cleanup_after:=now()+interval '15 minutes';end if;return new;
end$$;
create trigger media_deletion_grace before update on public.media_objects for each row execute function public.media_cleanup_grace();
update public.media_objects set cleanup_after=now()+interval '15 minutes' where state='deleting';
revoke all on function public.media_cleanup_grace() from public,anon,authenticated;
