-- Fuse RPCs. Every consequential mutation is a single transaction that locks the board row,
-- so concurrent tabs/refreshes serialize and converge (idempotency).
--
-- Conventions:
--   * Input validation raises before any write ("INVALID_INPUT: ...").
--   * After the board sync has run (which may explode tasks), functions never raise:
--     they return {ok:false, code} so the explosion is not rolled back.
--
-- Constants mirrored from src/domain: CRITICAL_EDIT_THRESHOLD = 0.75, BOARD 2000x1250.

------------------------------------------------------------------------------
-- Time helpers (internal)
------------------------------------------------------------------------------

create or replace function public._ms(i interval) returns double precision
language sql immutable as $$ select extract(epoch from i) * 1000 $$;

-- Paused milliseconds overlapping [p_from, p_to]. At most one open pause per board, so no merging needed.
create or replace function public._paused_ms(p_board uuid, p_from timestamptz, p_to timestamptz)
returns double precision language sql stable as $$
  select coalesce(sum(greatest(0, public._ms(
    least(least(ended_at, planned_end_at), p_to) - greatest(started_at, p_from)
  ))), 0)
  from public.board_pauses
  where board_id = p_board and started_at < p_to
$$;

create or replace function public._remaining_ms(t public.tasks, p_now timestamptz)
returns double precision language sql stable as $$
  select public._ms(t.deadline_at - t.fuse_started_at)
    - greatest(0, public._ms(p_now - t.fuse_started_at) - public._paused_ms(t.board_id, t.fuse_started_at, p_now))
$$;

create or replace function public._progress(t public.tasks, p_now timestamptz)
returns double precision language sql stable as $$
  select least(1, greatest(0, 1 - public._remaining_ms(t, p_now) / nullif(public._ms(t.deadline_at - t.fuse_started_at), 0)))
$$;

create or replace function public._my_board() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select id into b from boards where user_id = auth.uid();
  if b is null then raise exception 'NO_BOARD'; end if;
  return b;
end $$;

create or replace function public._open_incident(p_board uuid) returns public.board_incidents
language sql stable as $$
  select * from public.board_incidents where board_id = p_board and phase <> 'resolved' limit 1
$$;

------------------------------------------------------------------------------
-- Sync: close finished pauses, explode due tasks. Caller must hold the board lock.
------------------------------------------------------------------------------

create or replace function public._sync(p_board uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := app_now();
  p board_pauses;
  t tasks;
  v_incident uuid;
  v_remaining double precision;
  v_count integer := 0;
begin
  for p in
    select * from board_pauses where board_id = p_board and ended_at is null and planned_end_at <= v_now for update
  loop
    update board_pauses set ended_at = p.planned_end_at where id = p.id;
    insert into task_events (board_id, user_id, type, occurred_at, metadata)
    values (p_board, p.user_id, 'emergency_pause_ended', p.planned_end_at, jsonb_build_object(
      'pauseId', p.id, 'endedEarly', false, 'durationMs', _ms(p.planned_end_at - p.started_at)));
  end loop;

  for t in
    select * from tasks where board_id = p_board and status = 'active' order by deadline_at for update
  loop
    v_remaining := _remaining_ms(t, v_now);
    continue when v_remaining > 0;

    if v_incident is null then
      select id into v_incident from board_incidents where board_id = p_board and phase <> 'resolved' for update;
      if v_incident is null then
        insert into board_incidents (board_id, user_id, trigger_task_id, exploded_at)
        values (p_board, t.user_id, t.id, v_now) returning id into v_incident;
      else
        update board_incidents set phase = 'post_mortem' where id = v_incident;
      end if;
    end if;

    update tasks set status = 'exploded', explosion_count = explosion_count + 1, updated_at = v_now where id = t.id;

    insert into incident_tasks (incident_id, task_id, user_id, exploded)
    values (v_incident, t.id, t.user_id, true)
    on conflict (incident_id, task_id) do update set exploded = true, post_mortem_at = null, restored_at = null;

    insert into task_events (board_id, user_id, task_id, type, occurred_at, metadata)
    values (p_board, t.user_id, t.id, 'exploded', v_now, jsonb_build_object(
      'incidentId', v_incident,
      'fuseStartedAt', t.fuse_started_at,
      'deadlineAt', t.deadline_at,
      'fuseMs', _ms(t.deadline_at - t.fuse_started_at),
      'dueAt', v_now + make_interval(secs => v_remaining / 1000),
      'explosionCount', t.explosion_count + 1,
      'impact', t.impact));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- Resolve the incident once every active card is back on the board.
create or replace function public._maybe_resolve(p_incident uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  i board_incidents;
  v_now timestamptz := app_now();
  v_restored integer;
begin
  select * into i from board_incidents where id = p_incident;
  if i.phase <> 'rebuilding' then return false; end if;
  if exists (
    select 1 from incident_tasks it join tasks tk on tk.id = it.task_id
    where it.incident_id = p_incident and tk.status = 'active' and it.restored_at is null
  ) then return false; end if;

  select count(*) into v_restored from incident_tasks where incident_id = p_incident and restored_at is not null;
  update board_incidents set phase = 'resolved', resolved_at = v_now where id = p_incident;
  insert into task_events (board_id, user_id, type, occurred_at, metadata)
  values (i.board_id, i.user_id, 'board_restored', v_now, jsonb_build_object(
    'incidentId', i.id, 'triggerTaskId', i.trigger_task_id, 'restoredCount', v_restored,
    'explodedAt', i.exploded_at, 'durationMs', _ms(v_now - i.exploded_at)));
  return true;
end $$;

-- Move to rebuilding once every exploded task has its post-mortem.
create or replace function public._maybe_start_rebuild(p_incident uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i board_incidents;
begin
  select * into i from board_incidents where id = p_incident;
  if i.phase <> 'post_mortem' then return; end if;
  if exists (select 1 from incident_tasks where incident_id = p_incident and exploded and post_mortem_at is null) then
    return;
  end if;
  update board_incidents set phase = 'rebuilding', rebuild_started_at = coalesce(rebuild_started_at, app_now())
  where id = p_incident;
  insert into incident_tasks (incident_id, task_id, user_id)
  select p_incident, id, user_id from tasks where board_id = i.board_id and status = 'active'
  on conflict do nothing;
  perform _maybe_resolve(p_incident);
end $$;

------------------------------------------------------------------------------
-- Public RPCs
------------------------------------------------------------------------------

create or replace function public.sync_board() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := _my_board(); v_exploded integer;
begin
  perform 1 from boards where id = b for update;
  v_exploded := _sync(b);
  return jsonb_build_object('ok', true, 'exploded', v_exploded, 'serverNow', app_now());
end $$;

create or replace function public.create_task(
  p_title text, p_notes text, p_impact public.impact, p_deadline_at timestamptz,
  p_bother_after timestamptz, p_fuse_preset text, p_x integer, p_y integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  v_title text := btrim(coalesce(p_title, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_bother timestamptz := case when p_bother_after > v_now then p_bother_after end;
  t tasks;
begin
  if char_length(v_title) not between 1 and 200 then raise exception 'INVALID_INPUT: title'; end if;
  if p_deadline_at is null or p_deadline_at <= v_now + interval '1 minute' then
    raise exception 'INVALID_INPUT: deadline must be in the future';
  end if;
  if p_deadline_at > v_now + interval '2 years' then raise exception 'INVALID_INPUT: deadline too far'; end if;
  if v_bother is not null and v_bother >= p_deadline_at then
    raise exception 'INVALID_INPUT: bother_after must be before the deadline';
  end if;

  perform 1 from boards where id = b for update;
  perform _sync(b);
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok', false, 'code', 'BOARD_DESTROYED'); end if;

  insert into tasks (board_id, user_id, title, notes, impact, fuse_started_at, deadline_at, bother_after, position_x, position_y)
  values (b, auth.uid(), v_title, v_notes, coalesce(p_impact, 'normal'), v_now, p_deadline_at, v_bother,
    least(1890, greatest(110, coalesce(p_x, 160))), least(1190, greatest(60, coalesce(p_y, 120))))
  returning * into t;

  insert into task_events (board_id, user_id, task_id, type, metadata)
  values (b, t.user_id, t.id, 'created', jsonb_build_object(
    'fusePreset', p_fuse_preset, 'fuseMs', _ms(t.deadline_at - t.fuse_started_at),
    'deadlineAt', t.deadline_at, 'impact', t.impact, 'botherAfter', t.bother_after));

  return jsonb_build_object('ok', true, 'taskId', t.id);
end $$;

create or replace function public.update_task_content(p_task uuid, p_title text, p_notes text, p_impact public.impact)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_count integer;
begin
  if char_length(v_title) not between 1 and 200 then raise exception 'INVALID_INPUT: title'; end if;
  update tasks set title = v_title, notes = nullif(btrim(coalesce(p_notes, '')), ''), impact = p_impact, updated_at = app_now()
  where id = p_task and user_id = auth.uid() and status in ('active', 'exploded');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count = 1, 'code', case when v_count = 0 then 'NOT_FOUND' end);
end $$;

create or replace function public.move_task(p_task uuid, p_x integer, p_y integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := _my_board(); v_count integer;
begin
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok', false, 'code', 'BOARD_DESTROYED'); end if;
  update tasks set position_x = least(1890, greatest(110, p_x)), position_y = least(1190, greatest(60, p_y))
  where id = p_task and board_id = b and status = 'active';
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count = 1);
end $$;

-- Free deadline edit. Extending a fuse that is >= 75% burned must go through cut_wire.
-- p_new_end is the desired wall-clock end; the stored deadline excludes paused time.
create or replace function public.reschedule_task(p_task uuid, p_new_end timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  t tasks;
  v_remaining double precision;
  v_current_end timestamptz;
  v_new_deadline timestamptz;
begin
  if p_new_end is null or p_new_end <= v_now then raise exception 'INVALID_INPUT: deadline must be in the future'; end if;
  perform 1 from boards where id = b for update;
  perform _sync(b);
  select * into t from tasks where id = p_task and board_id = b for update;
  if t.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if t.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_ACTIVE'); end if;

  v_remaining := _remaining_ms(t, v_now);
  v_current_end := v_now + make_interval(secs => v_remaining / 1000);
  if p_new_end > v_current_end and _progress(t, v_now) >= 0.75 then
    return jsonb_build_object('ok', false, 'code', 'REQUIRES_WIRE_CUT');
  end if;
  v_new_deadline := t.deadline_at + (p_new_end - v_current_end);

  update tasks set deadline_at = v_new_deadline, updated_at = v_now where id = t.id;
  insert into task_events (board_id, user_id, task_id, type, metadata)
  values (b, t.user_id, t.id, 'rescheduled', jsonb_build_object(
    'source', 'edit', 'previousDeadline', t.deadline_at, 'newDeadline', v_new_deadline,
    'addedMs', _ms(p_new_end - v_current_end), 'progressAtChange', _progress(t, v_now)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cut_wire(
  p_task uuid, p_reason public.what_happened, p_explanation text, p_new_end timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  v_explanation text := btrim(coalesce(p_explanation, ''));
  t tasks;
  v_remaining double precision;
  v_current_end timestamptz;
  v_new_deadline timestamptz;
begin
  if p_reason is null then raise exception 'INVALID_INPUT: reason'; end if;
  if char_length(v_explanation) < 3 or char_length(v_explanation) > 2000 then raise exception 'INVALID_INPUT: explanation'; end if;
  if p_new_end is null or p_new_end <= v_now or p_new_end > v_now + interval '1 year' then
    raise exception 'INVALID_INPUT: new deadline';
  end if;

  perform 1 from boards where id = b for update;
  perform _sync(b);
  select * into t from tasks where id = p_task and board_id = b for update;
  if t.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if t.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_ACTIVE'); end if;

  v_remaining := _remaining_ms(t, v_now);
  v_current_end := v_now + make_interval(secs => v_remaining / 1000);
  if p_new_end <= v_current_end then return jsonb_build_object('ok', false, 'code', 'NOT_AN_EXTENSION'); end if;
  v_new_deadline := t.deadline_at + (p_new_end - v_current_end);

  -- explosion_count is intentionally untouched: cutting the wire never heals scars.
  update tasks set deadline_at = v_new_deadline, updated_at = v_now where id = t.id;
  insert into task_events (board_id, user_id, task_id, type, metadata)
  values (b, t.user_id, t.id, 'wire_cut', jsonb_build_object(
    'reason', p_reason, 'explanation', v_explanation,
    'previousDeadline', t.deadline_at, 'newDeadline', v_new_deadline,
    'previousEnd', v_current_end, 'newEnd', p_new_end,
    'addedMs', _ms(p_new_end - v_current_end),
    'remainingAtCutMs', v_remaining, 'progressAtCut', _progress(t, v_now),
    'fuseMs', _ms(t.deadline_at - t.fuse_started_at)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.complete_task(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  t tasks;
begin
  perform 1 from boards where id = b for update;
  perform _sync(b);
  select * into t from tasks where id = p_task and board_id = b for update;
  if t.id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if t.status = 'completed' then return jsonb_build_object('ok', true, 'already', true); end if;
  -- Includes a fuse that ran out just now: _sync above exploded it.
  if t.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'TASK_NOT_ACTIVE'); end if;

  update tasks set status = 'completed', completed_at = v_now, updated_at = v_now where id = t.id;
  insert into task_events (board_id, user_id, task_id, type, metadata)
  values (b, t.user_id, t.id, 'completed', jsonb_build_object(
    'explosionCount', t.explosion_count, 'afterExplosion', false,
    'progressAtCompletion', _progress(t, v_now), 'remainingMs', _remaining_ms(t, v_now),
    'fuseMs', _ms(t.deadline_at - t.fuse_started_at),
    'elapsedSinceCreatedMs', _ms(v_now - t.created_at)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.start_pause(p_hours integer, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  v_reason text := btrim(coalesce(p_reason, ''));
  p board_pauses;
begin
  if p_hours not in (2, 6, 12, 24) then raise exception 'INVALID_INPUT: duration'; end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 500 then raise exception 'INVALID_INPUT: reason'; end if;

  perform 1 from boards where id = b for update;
  perform _sync(b);
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok', false, 'code', 'BOARD_DESTROYED'); end if;
  if exists (select 1 from board_pauses where board_id = b and ended_at is null) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into board_pauses (board_id, user_id, reason, started_at, planned_end_at)
  values (b, auth.uid(), v_reason, v_now, v_now + make_interval(hours => p_hours))
  returning * into p;
  insert into task_events (board_id, user_id, type, metadata)
  values (b, p.user_id, 'emergency_pause_started', jsonb_build_object(
    'pauseId', p.id, 'reason', v_reason, 'plannedDurationMs', _ms(p.planned_end_at - p.started_at),
    'plannedEndAt', p.planned_end_at));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.end_pause() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  p board_pauses;
begin
  perform 1 from boards where id = b for update;
  perform _sync(b);
  select * into p from board_pauses where board_id = b and ended_at is null for update;
  if p.id is null then return jsonb_build_object('ok', true, 'already', true); end if;
  update board_pauses set ended_at = v_now where id = p.id;
  insert into task_events (board_id, user_id, type, metadata)
  values (b, p.user_id, 'emergency_pause_ended', jsonb_build_object(
    'pauseId', p.id, 'endedEarly', true, 'durationMs', _ms(v_now - p.started_at)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.submit_post_mortem(
  p_task uuid, p_reason public.what_happened, p_explanation text,
  p_resolution text, p_new_end timestamptz, p_discard_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  v_explanation text := btrim(coalesce(p_explanation, ''));
  v_discard text := btrim(coalesce(p_discard_reason, ''));
  i board_incidents;
  it incident_tasks;
  t tasks;
begin
  if p_reason is null then raise exception 'INVALID_INPUT: reason'; end if;
  if char_length(v_explanation) < 3 or char_length(v_explanation) > 2000 then raise exception 'INVALID_INPUT: explanation'; end if;
  if p_resolution not in ('complete', 'reschedule', 'discard') then raise exception 'INVALID_INPUT: resolution'; end if;
  if p_resolution = 'reschedule' and (p_new_end is null or p_new_end <= v_now + interval '1 minute' or p_new_end > v_now + interval '2 years') then
    raise exception 'INVALID_INPUT: new deadline';
  end if;
  if p_resolution = 'discard' and (char_length(v_discard) < 3 or char_length(v_discard) > 2000) then
    raise exception 'INVALID_INPUT: discard reason';
  end if;

  perform 1 from boards where id = b for update;
  perform _sync(b);
  i := _open_incident(b);
  if i.id is null then return jsonb_build_object('ok', false, 'code', 'NO_INCIDENT'); end if;
  select * into it from incident_tasks where incident_id = i.id and task_id = p_task for update;
  if it.task_id is null or not it.exploded then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if it.post_mortem_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into t from tasks where id = p_task for update;

  if p_resolution = 'complete' then
    update tasks set status = 'completed', completed_at = v_now, updated_at = v_now where id = t.id;
    insert into task_events (board_id, user_id, task_id, type, metadata)
    values (b, t.user_id, t.id, 'completed', jsonb_build_object('explosionCount', t.explosion_count, 'afterExplosion', true));
  elsif p_resolution = 'reschedule' then
    update tasks set status = 'active', fuse_started_at = v_now, deadline_at = p_new_end, bother_after = null, updated_at = v_now
    where id = t.id;
    insert into task_events (board_id, user_id, task_id, type, metadata)
    values (b, t.user_id, t.id, 'rescheduled', jsonb_build_object(
      'source', 'post_mortem', 'previousDeadline', t.deadline_at, 'newDeadline', p_new_end,
      'fuseMs', _ms(p_new_end - v_now)));
  else
    update tasks set status = 'discarded', discarded_at = v_now, updated_at = v_now where id = t.id;
    insert into task_events (board_id, user_id, task_id, type, metadata)
    values (b, t.user_id, t.id, 'discarded', jsonb_build_object('reason', v_discard, 'explosionCount', t.explosion_count));
  end if;

  insert into task_events (board_id, user_id, task_id, type, metadata)
  values (b, t.user_id, t.id, 'post_mortem', jsonb_build_object(
    'incidentId', i.id, 'reason', p_reason, 'explanation', v_explanation, 'resolution', p_resolution,
    'explosionCount', t.explosion_count));
  update incident_tasks set post_mortem_at = v_now where incident_id = i.id and task_id = t.id;

  perform _maybe_start_rebuild(i.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.restore_card(p_task uuid, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b uuid := _my_board();
  v_now timestamptz := app_now();
  i board_incidents;
  it incident_tasks;
  v_resolved boolean;
begin
  if p_x is null or p_y is null or p_x < 0 or p_x > 2000 or p_y < 0 or p_y > 1250 then
    raise exception 'INVALID_INPUT: outside the board';
  end if;

  perform 1 from boards where id = b for update;
  perform _sync(b);
  i := _open_incident(b);
  if i.id is null then return jsonb_build_object('ok', true, 'resolved', true); end if;
  if i.phase <> 'rebuilding' then return jsonb_build_object('ok', false, 'code', 'BOARD_DESTROYED'); end if;
  select * into it from incident_tasks where incident_id = i.id and task_id = p_task for update;
  if it.task_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;

  if it.restored_at is null then
    update tasks set position_x = least(1890, greatest(110, p_x)), position_y = least(1190, greatest(60, p_y))
    where id = p_task;
    update incident_tasks set restored_at = v_now where incident_id = i.id and task_id = p_task;
  end if;
  v_resolved := _maybe_resolve(i.id);
  return jsonb_build_object('ok', true, 'resolved', v_resolved);
end $$;

create or replace function public.complete_onboarding() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update profiles set onboarded_at = coalesce(onboarded_at, now()) where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------
-- Grants: only the public RPCs are callable, and only by signed-in users.
------------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.sync_board(),
  public.create_task(text, text, public.impact, timestamptz, timestamptz, text, integer, integer),
  public.update_task_content(uuid, text, text, public.impact),
  public.move_task(uuid, integer, integer),
  public.reschedule_task(uuid, timestamptz),
  public.cut_wire(uuid, public.what_happened, text, timestamptz),
  public.complete_task(uuid),
  public.start_pause(integer, text),
  public.end_pause(),
  public.submit_post_mortem(uuid, public.what_happened, text, text, timestamptz, text),
  public.restore_card(uuid, integer, integer),
  public.complete_onboarding()
to authenticated;
