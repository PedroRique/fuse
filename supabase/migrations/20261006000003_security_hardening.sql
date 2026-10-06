-- Private counters cannot be read/reset through the Data API.
create schema if not exists fuse_private;
revoke all on schema fuse_private from public, anon, authenticated;
create table fuse_private.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_seconds integer not null,
  started_at timestamptz not null,
  requests integer not null,
  primary key (user_id, action, window_seconds)
);
alter table fuse_private.rate_limits enable row level security;
revoke all on fuse_private.rate_limits from public, anon, authenticated;

create function fuse_private.consume(p_user uuid, p_action text, p_seconds integer, p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into fuse_private.rate_limits as r values (p_user,p_action,p_seconds,clock_timestamp(),1)
  on conflict (user_id,action,window_seconds) do update set
    started_at = case when r.started_at <= clock_timestamp()-make_interval(secs=>p_seconds) then clock_timestamp() else r.started_at end,
    requests = case when r.started_at <= clock_timestamp()-make_interval(secs=>p_seconds) then 1 else r.requests+1 end
  returning requests into n;
  return n <= p_limit;
end $$;
revoke all on function fuse_private.consume(uuid,text,integer,integer) from public, anon, authenticated;

create function fuse_private.task_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 904));
  if not fuse_private.consume(new.user_id,'task_create',60,30)
     or not fuse_private.consume(new.user_id,'task_create',86400,200) then
    raise exception 'RATE_LIMITED';
  end if;
  if (select count(*) from public.tasks where user_id=new.user_id) >= 5000
     or (select count(*) from public.tasks where user_id=new.user_id and status='active') >= 500 then
    raise exception 'TASK_LIMIT';
  end if;
  return new;
end $$;
revoke all on function fuse_private.task_quota() from public, anon, authenticated;
create trigger task_quota before insert on public.tasks for each row execute function fuse_private.task_quota();

-- URL parsing is intentionally conservative. No credentials, explicit ports,
-- suffix lookalikes, fragments, or alternate protocols can bypass the allowlist.
alter table public.push_subscriptions add constraint push_endpoint_allowed check (
  endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([A-Za-z0-9-]+[.])+push[.]apple[.]com|([A-Za-z0-9-]+[.])+notify[.]windows[.]com)/[^[:space:]#]+$'
) not valid;
alter table public.push_subscriptions add constraint push_keys_valid check (
  p256dh ~ '^[A-Za-z0-9_-]{87}=?$' and auth ~ '^[A-Za-z0-9_-]{22}(==)?$'
) not valid;
-- NOT VALID preserves existing devices; all new inserts/updates are enforced.
create function fuse_private.device_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 905));
  if (select count(*) from public.push_subscriptions where user_id=new.user_id) >= 10 then
    raise exception 'DEVICE_LIMIT';
  end if;
  if not fuse_private.consume(new.user_id,'device_register',3600,20) then raise exception 'RATE_LIMITED'; end if;
  return new;
end $$;
revoke all on function fuse_private.device_quota() from public, anon, authenticated;
create trigger device_quota before insert on public.push_subscriptions for each row execute function fuse_private.device_quota();

create function public.claim_push_test(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,906));
  return fuse_private.consume(p_user,'push_test',60,3)
     and fuse_private.consume(p_user,'push_test',3600,20);
end $$;
create function public.authorize_push_cron(p_token text) returns boolean
language sql security definer set search_path = '' as $$
  select p_token is not null and length(p_token) >= 32 and exists (
    select 1 from vault.decrypted_secrets where name='fuse_push_cron' and decrypted_secret=p_token
  );
$$;
revoke all on function public.claim_push_test(uuid), public.authorize_push_cron(text) from public, anon, authenticated;
grant execute on function public.claim_push_test(uuid), public.authorize_push_cron(text) to service_role;

alter function public.app_now() set search_path = '';
alter function public._ms(interval) set search_path = '';
alter function public._paused_ms(uuid,timestamptz,timestamptz) set search_path = '';
alter function public._remaining_ms(public.tasks,timestamptz) set search_path = '';
alter function public._progress(public.tasks,timestamptz) set search_path = '';
alter function public._open_incident(uuid) set search_path = '';
-- Public-schema CREATE must remain restricted; existing RPCs pin this schema.
revoke create on schema public from public, anon, authenticated;

-- Apply the same durable account limit to every mutation entrypoint, including
-- direct RPC calls and historical endpoints. Preserve their ownership checks.
do $$
declare f record; definition text;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'create_task','update_task_content','move_task','move_tasks','reschedule_task',
      'cut_wire','complete_task','start_pause','end_pause','submit_post_mortem',
      'restore_card','complete_onboarding','undo_complete_task','undo_layout'
    ])
  loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition, '\mbegin\M', E'begin\n  if auth.uid() is not null and not fuse_private.consume(auth.uid(), ''board_mutation'', 60, 120) then raise exception ''RATE_LIMITED''; end if;', 'i');
    execute definition;
  end loop;
end $$;
