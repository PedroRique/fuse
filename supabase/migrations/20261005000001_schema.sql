-- Fuse schema. Clients read through RLS; every write goes through security-definer RPCs.

-- Server clock. Production: now(). The local-only seed redefines it to support time travel.
create or replace function public.app_now() returns timestamptz
language sql stable as $$ select now() $$;

create type public.impact as enum ('low', 'normal', 'high', 'critical');
create type public.task_status as enum ('active', 'completed', 'discarded', 'exploded');
create type public.task_event_type as enum (
  'created', 'completed', 'wire_cut', 'exploded', 'rescheduled', 'discarded',
  'emergency_pause_started', 'emergency_pause_ended', 'post_mortem', 'board_restored'
);
create type public.incident_phase as enum ('post_mortem', 'rebuilding', 'resolved');
create type public.what_happened as enum (
  'unexpected', 'waiting', 'underestimated', 'procrastinated', 'no_longer_relevant', 'other'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  onboarded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (notes is null or char_length(notes) <= 5000),
  impact public.impact not null default 'normal',
  status public.task_status not null default 'active',
  fuse_started_at timestamptz not null,
  deadline_at timestamptz not null,
  bother_after timestamptz,
  explosion_count integer not null default 0 check (explosion_count >= 0),
  position_x integer not null default 0,
  position_y integer not null default 0,
  completed_at timestamptz,
  discarded_at timestamptz,
  created_at timestamptz not null default public.app_now(),
  updated_at timestamptz not null default public.app_now(),
  check (deadline_at > fuse_started_at)
);
create index tasks_board_status_idx on public.tasks (board_id, status);

-- Append-only history. task_id is null for board-level events (pauses, rebuilds).
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  type public.task_event_type not null,
  occurred_at timestamptz not null default public.app_now(),
  metadata jsonb not null default '{}'::jsonb
);
create index task_events_user_time_idx on public.task_events (user_id, occurred_at desc);
create index task_events_task_idx on public.task_events (task_id);

create table public.board_pauses (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  started_at timestamptz not null,
  planned_end_at timestamptz not null,
  ended_at timestamptz,
  check (planned_end_at > started_at and planned_end_at - started_at <= interval '24 hours'),
  check (ended_at is null or ended_at >= started_at)
);
create unique index board_pauses_one_open on public.board_pauses (board_id) where ended_at is null;

create table public.board_incidents (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger_task_id uuid not null references public.tasks (id) on delete cascade,
  phase public.incident_phase not null default 'post_mortem',
  exploded_at timestamptz not null,
  rebuild_started_at timestamptz,
  resolved_at timestamptz
);
create unique index board_incidents_one_open on public.board_incidents (board_id) where phase <> 'resolved';

-- Tasks involved in an incident: the ones that exploded (need a post-mortem)
-- and every active card that has to be put back during the rebuild.
create table public.incident_tasks (
  incident_id uuid not null references public.board_incidents (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exploded boolean not null default false,
  post_mortem_at timestamptz,
  restored_at timestamptz,
  primary key (incident_id, task_id)
);

-- RLS: owners can read their rows. No write policies: writes only via RPCs.
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.board_pauses enable row level security;
alter table public.board_incidents enable row level security;
alter table public.incident_tasks enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own board" on public.boards for select to authenticated using (user_id = (select auth.uid()));
create policy "own tasks" on public.tasks for select to authenticated using (user_id = (select auth.uid()));
create policy "own events" on public.task_events for select to authenticated using (user_id = (select auth.uid()));
create policy "own pauses" on public.board_pauses for select to authenticated using (user_id = (select auth.uid()));
create policy "own incidents" on public.board_incidents for select to authenticated using (user_id = (select auth.uid()));
create policy "own incident tasks" on public.incident_tasks for select to authenticated using (user_id = (select auth.uid()));

revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- Profile + board on signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.boards (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
