\set ON_ERROR_STOP on
-- пользователи: A (admin), B (student)
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'admin@example.com'), ('00000000-0000-0000-0000-00000000000b', 'student@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
select count(*) = 2 as "профили созданы триггером" from public.profiles;

-- 1. студент не может опубликовать учебную базу
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin perform public.publish_content_pack((select p from public.tmp_pack)); raise exception 'FAIL: студент опубликовал'; exception when insufficient_privilege then raise notice 'OK: студенту публикация запрещена'; end $$;
-- 2. студент не может поднять себе роль
do $$ begin update public.profiles set role = 'admin' where id = auth.uid(); raise exception 'FAIL: роль повышена'; exception when insufficient_privilege then raise notice 'OK: повысить себе роль нельзя'; end $$;
reset role;
select role = 'student' as "роль студента не изменилась" from public.profiles where id = '00000000-0000-0000-0000-00000000000b';
