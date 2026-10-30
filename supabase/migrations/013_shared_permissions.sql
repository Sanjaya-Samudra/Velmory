-- Read-only invitations and owner-managed access. Existing clients remain editors.
alter table public.shared_diary_members drop constraint shared_diary_members_role_check;
alter table public.shared_diary_members add constraint shared_diary_members_role_check check(role in ('owner','editor','viewer'));
create function public.set_shared_member_role(p_diary_id uuid,p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$begin
 if not public.active_user() or not public.is_shared_diary_owner(p_diary_id) then raise exception 'Owner access required'; end if;
 if p_role is null or p_role not in ('editor','viewer') then raise exception 'Invalid permission';end if;
 update public.shared_diary_members set role=p_role where diary_id=p_diary_id and user_id=p_user_id and role<>'owner' and status in ('pending','active');
 if not found then raise exception 'Member unavailable';end if;
end$$;
revoke all on function public.set_shared_member_role(uuid,uuid,text) from public,anon;
grant execute on function public.set_shared_member_role(uuid,uuid,text) to authenticated;
create or replace function public.save_shared_page(
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
    where diary_id=p_diary_id and user_id=auth.uid() and status='active' and role in ('owner','editor') for update)
    then raise exception 'Not a member of this shared diary'; end if;
  if p_page_id is null or p_page_id !~ '^[a-zA-Z0-9-]{1,80}$'
    or not public.valid_cipher(p_envelope)
    or octet_length(p_envelope::text) > 8000000
    then raise exception 'Invalid page data'; end if;
  if p_expected_revision is null or p_expected_revision < 0
    then raise exception 'Invalid revision'; end if;
  perform 1 from public.shared_diaries where id=p_diary_id for update;
  select * into old from public.shared_diary_pages
    where diary_id=p_diary_id and page_id=p_page_id;
  if found and old.envelope=p_envelope and old.deleted=p_deleted then return old.revision; end if;
  if coalesce(old.revision,0) <> p_expected_revision then raise exception 'revision_conflict'; end if;
  result := coalesce(old.revision,0)+1;
  insert into public.shared_diary_pages(diary_id, page_id, author_id, envelope, revision, deleted)
    values(p_diary_id, p_page_id, auth.uid(), p_envelope, result, p_deleted)
    on conflict(diary_id, page_id) do update
      set id=default, envelope=excluded.envelope, revision=excluded.revision,
          deleted=excluded.deleted, author_id=excluded.author_id,
          updated_at=clock_timestamp();
  return result;
end$$;

create or replace function public.update_shared_diary_milestone(
  p_diary_id uuid,
  p_milestone_date date,
  p_milestone_label text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.active_user() then raise exception 'Account unavailable'; end if;
  if not exists(select 1 from public.shared_diary_members where diary_id=p_diary_id and user_id=auth.uid() and status='active' and role in ('owner','editor'))
    then raise exception 'Not a member of this shared diary'; end if;
  if p_milestone_label is not null and length(p_milestone_label) not between 1 and 100
    then raise exception 'Invalid milestone label'; end if;
  update public.shared_diaries
    set milestone_date=p_milestone_date, milestone_label=p_milestone_label
    where id=p_diary_id;
end$$;


create function public.invite_shared_member_with_role(p_diary_id uuid,p_user_id uuid,p_wrapped_key text,p_recipient_key text,p_role text) returns void
language plpgsql security definer set search_path='' as $$begin
 if p_role is null or p_role not in ('viewer','editor') then raise exception 'Invalid permission';end if;
 perform public.invite_shared_member(p_diary_id,p_user_id,p_wrapped_key,p_recipient_key);
 perform public.set_shared_member_role(p_diary_id,p_user_id,p_role);
end$$;
revoke all on function public.invite_shared_member_with_role(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.invite_shared_member_with_role(uuid,uuid,text,text,text) to authenticated;
