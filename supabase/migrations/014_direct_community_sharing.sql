-- ------------------------------------------------------------------------------
-- 014_direct_community_sharing.sql
-- Direct sharing by email & seamless community connection for Future Letters
-- ------------------------------------------------------------------------------

-- 1. Helper function to look up any registered Velmory user's public key by email
create or replace function public.lookup_user_for_sharing(p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_user record;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if p_email is null or length(trim(p_email)) > 254 then raise exception 'Invalid email'; end if;
  
  select p.id, p.email, v.public_key, v.revision
  into target_user
  from public.profiles p
  join public.vaults v on v.owner_id = p.id
  where lower(trim(p.email)) = lower(trim(p_email))
    and p.status = 'active';
    
  if target_user.id is null then
    return jsonb_build_object('found', false, 'error', 'No active Velmory account with an initialized vault was found for this email address. Ask them to create an account first.');
  end if;
  
  if target_user.id = auth.uid() then
    return jsonb_build_object('found', false, 'error', 'You cannot invite your own account.');
  end if;
  
  return jsonb_build_object(
    'found', true,
    'id', target_user.id,
    'email', target_user.email,
    'public_key', target_user.public_key,
    'revision', target_user.revision
  );
end$$;

revoke all on function public.lookup_user_for_sharing(text) from public, anon;
grant execute on function public.lookup_user_for_sharing(text) to authenticated;

-- 2. Allow inviting any registered user with an active vault to a shared diary
create or replace function public.invite_shared_member(
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

  -- Ensure they are connected in contacts so they can also send Future Letters
  update public.contacts
    set status = 'accepted'
    where (sender_id = auth.uid() and recipient_id = p_user_id)
       or (sender_id = p_user_id and recipient_id = auth.uid());
  if not found then
    insert into public.contacts(sender_id, recipient_id, status)
    values(auth.uid(), p_user_id, 'accepted');
  end if;
end$$;

-- 3. When an invite is accepted, ensure mutual accepted contact connection
create or replace function public.accept_shared_invite(p_diary_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d_owner uuid;
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  update public.shared_diary_members
    set status='active', joined_at=now()
    where diary_id=p_diary_id and user_id=auth.uid() and status='pending';
  if not found then raise exception 'Invitation unavailable'; end if;

  select owner_id into d_owner from public.shared_diaries where id=p_diary_id;
  if d_owner is not null and d_owner <> auth.uid() then
    update public.contacts
      set status = 'accepted'
      where (sender_id = d_owner and recipient_id = auth.uid())
         or (sender_id = auth.uid() and recipient_id = d_owner);
    if not found then
      insert into public.contacts(sender_id, recipient_id, status)
      values(d_owner, auth.uid(), 'accepted');
    end if;
  end if;
end$$;
