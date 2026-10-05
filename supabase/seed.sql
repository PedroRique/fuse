-- LOCAL DEVELOPMENT ONLY. `supabase db reset` runs this; production deploys never do.
-- Enables time travel: app_now() = now() + offset.

create table if not exists public.dev_clock (
  id boolean primary key default true check (id),
  offset_ms bigint not null default 0
);
insert into public.dev_clock (id, offset_ms) values (true, 0) on conflict (id) do nothing;
alter table public.dev_clock enable row level security;
revoke all on public.dev_clock from anon, authenticated;

create or replace function public.app_now() returns timestamptz
language sql stable security definer set search_path = public as $$
  select now() + make_interval(secs => coalesce((select offset_ms from public.dev_clock), 0) / 1000.0)
$$;
revoke execute on function public.app_now() from public, anon, authenticated;
