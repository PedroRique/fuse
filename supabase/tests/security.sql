-- Run with an admin connection. Fixtures and all counters are rolled back.
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); t uuid;
begin
  insert into auth.users(id,email) values(a,a::text||'@security.invalid'),(b,b::text||'@security.invalid');
  insert into public.tasks(board_id,user_id,title,fuse_started_at,deadline_at,position_x,position_y)
    select id,b,'Private fixture',now(),now()+interval '1 day',160,120 from public.boards where user_id=b returning id into t;
  perform set_config('test.owner',a::text,true);
  perform set_config('test.foreign',t::text,true);
  perform set_config('request.jwt.claim.sub',a::text,true);
end $$;
set local role authenticated;
do $$
declare t uuid := current_setting('test.foreign')::uuid; r jsonb; q text;
begin
  if exists(select 1 from public.tasks where id=t) then raise exception 'FAIL: foreign task readable'; end if;
  if exists(select 1 from public.boards where user_id<>auth.uid()) then raise exception 'FAIL: foreign board readable'; end if;
  for q in select unnest(array[
    format('select public.update_task_content(%L,''Hacked'',null,''normal'')',t),
    format('select public.move_task(%L,500,500)',t),
    format('select public.move_tasks(''[{'||'"id":"%s","x":500,"y":500}]''::jsonb)',t),
    format('select public.complete_task(%L)',t),
    format('select public.reschedule_task(%L,now()+interval ''2 days'')',t),
    format('select public.cut_wire(%L,''other'',''Security test'',now()+interval ''2 days'')',t),
    format('select public.undo_complete_task(%L)',t),
    format('select public.restore_card(%L,500,500)',t),
    format('select public.submit_post_mortem(%L,''other'',''Security test'',''complete'',null,null)',t),
    format('select public.undo_layout(''[{'||'"id":"%s","x":500,"y":500,"expectedX":160,"expectedY":120}]''::jsonb)',t)
  ]) loop
    execute q into r;
    -- restore_card is idempotent when the caller's board has no incident;
    -- that branch returns resolved=true without accessing the supplied task.
    if (r->>'ok')::boolean and not (q like 'select public.restore_card%' and r->>'resolved'='true') then
      raise exception 'FAIL: foreign mutation succeeded: %',q;
    end if;
  end loop;
  -- Existing normal owner flows still work.
  r := public.create_task('Owned fixture',null,'normal',now()+interval '1 day',null,'today',160,120);
  if not (r->>'ok')::boolean then raise exception 'FAIL: owner create'; end if;
  r := public.update_task_content((r->>'taskId')::uuid,'Updated',null,'high');
  if not (r->>'ok')::boolean then raise exception 'FAIL: owner update'; end if;
  begin
    insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values(auth.uid(),'https://fcm.googleapis.com.evil.example/send/test',repeat('a',87),repeat('b',22));
    raise exception 'FAIL: invalid endpoint accepted';
  exception when check_violation then null; end;
  begin
    perform public.push_configuration();
    raise exception 'FAIL: private config accessible';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare a uuid := current_setting('test.owner')::uuid; i integer;
begin
  if not exists(select 1 from public.tasks where id=current_setting('test.foreign')::uuid and title='Private fixture' and position_x=160 and status='active') then
    raise exception 'FAIL: foreign task changed';
  end if;
  -- Per-account tests work across devices and do not expose a reset endpoint.
  for i in 1..3 loop
    if not public.claim_push_test(a) then raise exception 'FAIL: test quota too strict'; end if;
  end loop;
  if public.claim_push_test(a) then raise exception 'FAIL: test quota exceeded'; end if;
  if public.authorize_push_cron('invalid') then raise exception 'FAIL: cron accepted'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proconfig is null) then raise exception 'FAIL: mutable search path'; end if;
  if has_schema_privilege('authenticated','fuse_private','USAGE') then raise exception 'FAIL: counters exposed'; end if;
  for i in 1..10 loop
    insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values(a,'https://fcm.googleapis.com/send/'||a::text||'/'||i,repeat('a',87),repeat('b',22));
  end loop;
  begin
    insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values(a,'https://fcm.googleapis.com/send/'||a::text||'/11',repeat('a',87),repeat('b',22));
    raise exception 'FAIL: device quota exceeded';
  exception when raise_exception then if sqlerrm <> 'DEVICE_LIMIT' then raise; end if; end;
  -- Raise the private fixture counter to verify the public RPC is bounded.
  update fuse_private.rate_limits set requests=120 where user_id=a and action='board_mutation';
end $$;
set local role authenticated;
do $$
begin
  begin
    perform public.move_tasks('[]'::jsonb);
    raise exception 'FAIL: RPC quota exceeded';
  exception when raise_exception then if sqlerrm <> 'RATE_LIMITED' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.move_tasks('[]'::jsonb);
    raise exception 'FAIL: anonymous RPC access';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: ownership, owner writes, anonymous access, private config/counters, endpoints, quotas, search paths' as security_tests;
rollback;
