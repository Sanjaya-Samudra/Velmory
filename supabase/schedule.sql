-- Run only after setting project_url and scheduler_secret in Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('velmory-letter-dispatch','* * * * *',$$
 select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/letter-dispatch',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='scheduler_secret')),
 body:='{}'::jsonb,
 timeout_milliseconds:=60000
 );
$$);

-- Storage garbage collection and durable account deletion.
select cron.schedule('velmory-maintenance','*/5 * * * *',$$
 select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/maintenance',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='scheduler_secret')),
 body:='{}'::jsonb,
 timeout_milliseconds:=60000
 );
$$);
