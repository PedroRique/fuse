begin;
do $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values(u,u::text||'@import-test.invalid');
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('test.import_user',u::text,true);
end $$;
set local role authenticated;
do $$
declare request uuid := gen_random_uuid(); payload jsonb; r jsonb; replay jsonb; i integer;
begin
  payload := jsonb_build_array(
    jsonb_build_object('title','First','notes','Notes','impact','high','deadlineAt',now()+interval '1 day'),
    jsonb_build_object('title','Second','notes','','impact','normal','deadlineAt',now()+interval '2 days'));
  r := public.import_tasks(request,payload);
  if not (r->>'ok')::boolean or jsonb_array_length(r->'taskIds')<>2 then raise exception 'FAIL: import'; end if;
  replay := public.import_tasks(request,payload);
  if replay->'taskIds'<>r->'taskIds' or not (replay->>'replayed')::boolean or (select count(*) from public.tasks)<>2 then raise exception 'FAIL: duplicate retry'; end if;
  begin
    perform public.import_tasks(request,jsonb_build_array(payload->0));
    raise exception 'FAIL: changed retry';
  exception when raise_exception then if sqlerrm <> 'IMPORT_CHANGED' then raise; end if; end;
  begin
    perform public.import_tasks(gen_random_uuid(),payload||jsonb_build_array(jsonb_build_object('title','Invalid','notes','','impact','normal','deadlineAt',now()-interval '1 day')));
    raise exception 'FAIL: invalid batch accepted';
  exception when raise_exception then if sqlerrm not like 'INVALID_INPUT:%' then raise; end if; end;
  if (select count(*) from public.tasks)<>2 then raise exception 'FAIL: partial invalid batch'; end if;
  for i in 1..3 loop if not public.claim_task_extraction() then raise exception 'FAIL: extraction allowance'; end if; end loop;
  if public.claim_task_extraction() then raise exception 'FAIL: extraction quota'; end if;
end $$;
reset role;
-- Force the task quota to expire mid-batch; the first row must roll back too.
update fuse_private.rate_limits set requests=29 where user_id=current_setting('test.import_user')::uuid and action='task_create' and window_seconds=60;
set local role authenticated;
do $$
declare payload jsonb;
begin
  payload := jsonb_build_array(jsonb_build_object('title','Quota 1','notes','','impact','normal','deadlineAt',now()+interval '1 day'),
    jsonb_build_object('title','Quota 2','notes','','impact','normal','deadlineAt',now()+interval '1 day'));
  begin
    perform public.import_tasks(gen_random_uuid(),payload);
    raise exception 'FAIL: quota batch accepted';
  exception when raise_exception then if sqlerrm <> 'RATE_LIMITED' then raise; end if; end;
  if (select count(*) from public.tasks)<>2 then raise exception 'FAIL: partial quota batch'; end if;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.import_tasks(gen_random_uuid(),'[]');
    raise exception 'FAIL: anonymous import';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: atomic imports, idempotent replay, changed replay blocked, quota rollback, anonymous denial, extraction limit' as task_import_tests;
rollback;
