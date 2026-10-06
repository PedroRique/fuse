-- Save a whole rearrangement in one transaction; never leave half the cards moved.
create or replace function public.move_tasks(p_changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b uuid := public._my_board();
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes)>1000 then
    raise exception 'INVALID_INPUT: positions';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_changes) as c(id uuid,x integer,y integer)
    where c.id is null or c.x is null or c.y is null or abs(c.x::bigint)>10000 or abs(c.y::bigint)>10000)
    or exists(select 1 from jsonb_to_recordset(p_changes) as c(id uuid,x integer,y integer) group by id having count(*)>1) then
    raise exception 'INVALID_INPUT: positions';
  end if;
  perform 1 from public.boards where id=b for update;
  perform public._sync(b);
  if (public._open_incident(b)).id is not null then return jsonb_build_object('ok',false,'code','BOARD_DESTROYED'); end if;
  if exists(select 1 from jsonb_to_recordset(p_changes) as c(id uuid,x integer,y integer)
    left join public.tasks t on t.id=c.id and t.board_id=b and t.status in ('active','completed')
    where t.id is null) then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  update public.tasks t set position_x=least(1890,greatest(110,c.x)),position_y=least(1190,greatest(60,c.y))
  from jsonb_to_recordset(p_changes) as c(id uuid,x integer,y integer) where t.id=c.id and t.board_id=b;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.move_tasks(jsonb) from public,anon;
grant execute on function public.move_tasks(jsonb) to authenticated;
