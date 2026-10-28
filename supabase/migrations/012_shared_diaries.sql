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
