-- Device subscriptions are private to their owner. Dispatch is service-role only.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 20 and 2048),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 20 and 30),
  created_at timestamptz not null default now(),
  last_test_at timestamptz
);
create index push_subscriptions_owner on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.push_subscriptions to authenticated;
grant update (p256dh, auth) on public.push_subscriptions to authenticated;

create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  fuse_started_at timestamptz not null,
  deadline_at timestamptz not null,
  stage text not null check (stage in ('warning', 'critical')),
  sent_at timestamptz,
  claimed_at timestamptz,
  attempts integer not null default 0,
  unique(subscription_id, task_id, fuse_started_at, deadline_at, stage)
);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;
grant all on public.push_subscriptions, public.push_deliveries to service_role;

-- Vault holds VAPID private key and scheduler token; nothing secret enters the browser.
create function public.push_configuration() returns jsonb
language sql security definer set search_path = '' as $$
select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
from vault.decrypted_secrets where name in ('fuse_push_public','fuse_push_private','fuse_push_cron');
$$;

create function public.push_task_stage(p_task uuid) returns text
language sql stable set search_path = '' as $$
select case when public._progress(t, now()) >= 0.9 then 'critical' else 'warning' end
from public.tasks t where t.id = p_task and t.status = 'active'
and public._remaining_ms(t, now()) > 0 and public._progress(t, now()) >= 0.75
and (t.bother_after is null or t.bother_after <= now())
and not exists (select 1 from public.board_incidents i where i.board_id=t.board_id and i.phase <> 'resolved')
and not exists (select 1 from public.board_pauses p where p.board_id=t.board_id
  and p.started_at <= now() and least(p.ended_at,p.planned_end_at) > now());
$$;

create function public.claim_push_deliveries() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not pg_try_advisory_xact_lock(86473021) then return '[]'::jsonb; end if;
  -- Keep sent markers for active fuses, including ones that stay critical for months.
  delete from public.push_deliveries d using public.tasks t where d.task_id=t.id
    and t.status <> 'active' and coalesce(d.sent_at,d.claimed_at) < now() - interval '30 days';
  insert into public.push_deliveries(subscription_id,task_id,fuse_started_at,deadline_at,stage)
  select s.id,t.id,t.fuse_started_at,t.deadline_at,public.push_task_stage(t.id)
  from public.tasks t join public.push_subscriptions s on s.user_id=t.user_id
  where t.status='active' and public.push_task_stage(t.id) is not null
  on conflict do nothing;
  with candidates as (
    select d.id from public.push_deliveries d join public.tasks t on t.id=d.task_id
    where d.sent_at is null and d.attempts < 5
    and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    and d.stage=public.push_task_stage(t.id)
    and d.fuse_started_at=t.fuse_started_at and d.deadline_at=t.deadline_at
    order by d.claimed_at nulls first limit 100 for update of d skip locked
  ), claimed as (
    update public.push_deliveries d set claimed_at=now(), attempts=attempts+1
    where id in (select id from candidates) returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'subscriptionId',s.id,
    'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth,'taskId',t.id,
    'title',t.title,'stage',d.stage,'remainingMs',public._remaining_ms(t,now()))), '[]'::jsonb)
  into result from claimed d join public.push_subscriptions s on s.id=d.subscription_id
  join public.tasks t on t.id=d.task_id;
  return result;
end $$;

revoke all on function public.push_configuration(), public.push_task_stage(uuid), public.claim_push_deliveries() from public, anon, authenticated;
grant execute on function public.push_configuration(), public.push_task_stage(uuid), public.claim_push_deliveries() to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- URLs and tokens are provisioned in Vault, so the migration works across projects.
select cron.schedule('fuse-web-push','* * * * *', $job$
 select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='fuse_push_url'),
   headers := jsonb_build_object('Content-Type','application/json','x-fuse-cron',
     (select decrypted_secret from vault.decrypted_secrets where name='fuse_push_cron')),
   body := '{"mode":"dispatch"}'::jsonb,
   timeout_milliseconds := 55000
 ) where exists(select 1 from public.push_subscriptions);
$job$);
