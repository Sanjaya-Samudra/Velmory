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
