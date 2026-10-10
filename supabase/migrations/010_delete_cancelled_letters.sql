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
