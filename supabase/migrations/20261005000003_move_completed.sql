-- Completed cards stay on the canvas, so they still need to move.
create or replace function public.move_task(p_task uuid, p_x integer, p_y integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := _my_board(); v_count integer;
begin
  if (_open_incident(b)).id is not null then return jsonb_build_object('ok', false, 'code', 'BOARD_DESTROYED'); end if;
  update tasks set position_x = least(1890, greatest(110, p_x)), position_y = least(1190, greatest(60, p_y))
  where id = p_task and board_id = b and status in ('active', 'completed');
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', v_count = 1);
end $$;
