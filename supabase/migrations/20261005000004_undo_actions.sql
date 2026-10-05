-- Undo recent completion without extending the original fuse.
create or replace function public.undo_complete_task(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := _my_board(); t tasks;
begin
  perform 1 from boards where id=b for update;
  select * into t from tasks where id=p_task and board_id=b for update;
  if t.id is null or t.status <> 'completed' or t.completed_at < app_now() - interval '20 seconds' then
    return jsonb_build_object('ok',false,'code','UNDO_UNAVAILABLE');
  end if;
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok',false,'code','BOARD_DESTROYED'); end if;
  if not exists (select 1 from task_events where task_id=t.id and type='completed' and occurred_at=t.completed_at and metadata->>'afterExplosion'='false') then
    return jsonb_build_object('ok',false,'code','UNDO_UNAVAILABLE');
  end if;
  update tasks set status='active',completed_at=null,updated_at=app_now() where id=t.id;
  insert into task_events(board_id,user_id,task_id,type,metadata)
    values(b,auth.uid(),t.id,'rescheduled',jsonb_build_object('source','undo_completion'));
  perform _sync(b);
  return jsonb_build_object('ok',true);
end $$;

-- Validate every expected position before restoring any of them.
create or replace function public.undo_layout(p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := _my_board(); c jsonb; t tasks;
begin
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes)>1000 then raise exception 'INVALID_INPUT: positions'; end if;
  perform 1 from boards where id=b for update;
  perform _sync(b);
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok',false,'code','BOARD_DESTROYED'); end if;
  for c in select value from jsonb_array_elements(p_changes) loop
    select * into t from tasks where id=(c->>'id')::uuid and board_id=b for update;
    if t.id is null or t.status not in ('active','completed') or t.position_x <> (c->>'expectedX')::int or t.position_y <> (c->>'expectedY')::int then
      return jsonb_build_object('ok',false,'code','UNDO_UNAVAILABLE');
    end if;
  end loop;
  for c in select value from jsonb_array_elements(p_changes) loop
    update tasks set position_x=least(1890,greatest(110,(c->>'x')::int)),position_y=least(1190,greatest(60,(c->>'y')::int))
      where id=(c->>'id')::uuid and board_id=b;
  end loop;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.undo_complete_task(uuid),public.undo_layout(jsonb) from public,anon;
grant execute on function public.undo_complete_task(uuid),public.undo_layout(jsonb) to authenticated;
