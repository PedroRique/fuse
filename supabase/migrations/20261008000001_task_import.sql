-- Review is client-side; committed batches are owned and replay-safe.
create table fuse_private.import_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload_hash text not null,
  task_ids jsonb not null,
  primary key(user_id,request_id)
);
alter table fuse_private.import_batches enable row level security;
revoke all on fuse_private.import_batches from public,anon,authenticated;

-- A committed, authenticated quota check occurs BEFORE the paid model request.
-- Clients may consume their own quota but cannot reset or inspect the counters.
create function public.claim_task_extraction() returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,907));
  return fuse_private.consume(u,'ai_extract',60,3)
     and fuse_private.consume(u,'ai_extract',86400,20);
end $$;
revoke all on function public.claim_task_extraction() from public,anon;
grant execute on function public.claim_task_extraction() to authenticated;

create function public.import_tasks(p_request uuid,p_tasks jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b uuid := public._my_board(); u uuid := auth.uid(); c jsonb; ids jsonb := '[]';
  previous fuse_private.import_batches; r jsonb; v_now timestamptz := public.app_now();
begin
  if p_request is null or p_tasks is null or jsonb_typeof(p_tasks)<>'array'
     or jsonb_array_length(p_tasks) not between 1 and 30 then raise exception 'INVALID_INPUT: import'; end if;
  -- Keep the same lock order as create_task: quota row, then board row.
  if not fuse_private.consume(u,'board_mutation',60,120) then raise exception 'RATE_LIMITED'; end if;
  perform 1 from public.boards where id=b for update;
  select * into previous from fuse_private.import_batches where user_id=u and request_id=p_request;
  if found then
    if previous.payload_hash<>md5(p_tasks::text) then raise exception 'IMPORT_CHANGED'; end if;
    return jsonb_build_object('ok',true,'taskIds',previous.task_ids,'replayed',true);
  end if;
  -- Validate the complete batch before syncing or creating any task.
  for c in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(c)<>'object' or jsonb_typeof(c->'title')<>'string'
       or coalesce(length(btrim(c->>'title')),0) not between 1 and 200
       or coalesce(jsonb_typeof(c->'notes'),'null') not in ('null','string')
       or length(coalesce(c->>'notes',''))>5000
       or c->>'impact' is null or c->>'impact' not in ('low','normal','high','critical')
       or c->>'deadlineAt' is null
       or (c->>'deadlineAt')::timestamptz <= v_now + interval '1 minute'
       or (c->>'deadlineAt')::timestamptz > v_now + interval '2 years' then
      raise exception 'INVALID_INPUT: import task';
    end if;
  end loop;
  perform public._sync(b);
  if (public._open_incident(b)).id is not null then return jsonb_build_object('ok',false,'code','BOARD_DESTROYED'); end if;
  -- create_task enforces the same ownership, account, and task quotas as manual
  -- capture. Any quota/input error rolls back ALL tasks and their history.
  for c in select value from jsonb_array_elements(p_tasks) loop
    r := public.create_task(c->>'title',c->>'notes',(c->>'impact')::public.impact,
      (c->>'deadlineAt')::timestamptz,null,'import',160,120);
    if not (r->>'ok')::boolean then raise exception 'IMPORT_FAILED'; end if;
    ids := ids || jsonb_build_array(r->>'taskId');
  end loop;
  insert into fuse_private.import_batches values(u,p_request,md5(p_tasks::text),ids);
  return jsonb_build_object('ok',true,'taskIds',ids);
end $$;
revoke all on function public.import_tasks(uuid,jsonb) from public,anon;
grant execute on function public.import_tasks(uuid,jsonb) to authenticated;
