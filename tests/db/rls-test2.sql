\set ON_ERROR_STOP on
-- 3. администратор публикует пакет (2 вопроса утверждены оверлеем)
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.publish_content_pack((select p from public.tmp_pack)) as "опубликована версия";
reset role;
select (select count(*) from public.questions) as questions, (select count(*) from public.formulas) as formulas, (select count(*) from public.theories) as theory,
       (select count(*) from public.source_pages) as pages, (select count(*) from public.hints) as hints, (select count(*) from public.answer_options) as options;
select jsonb_array_length(pack -> 'questions') as "вопросов в публичной версии" from public.content_versions;

-- 4. студент видит только утверждённые вопросы и свои попытки
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select count(*) as "вопросов видит студент" from public.questions;
select count(*) as "подсказок видит студент" from public.hints;
insert into public.test_attempts (id, user_id, mode, title, config, question_ids, seed, started_at) values ('att-b', auth.uid(), 'test', 't', '{}', '{}', 1, now());
insert into public.user_progress (user_id, topic_id, studied_at) values (auth.uid(), 'ta-speed', now());
do $$ begin insert into public.test_attempts (id, user_id, mode, title, config, question_ids, seed, started_at) values ('att-x', '00000000-0000-0000-0000-00000000000a', 'test', 't', '{}', '{}', 1, now()); raise exception 'FAIL: записал чужую попытку'; exception when insufficient_privilege then raise notice 'OK: чужую попытку записать нельзя'; end $$;
-- 5. другой пользователь (админ) не видит прогресс студента
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select count(*) as "чужих попыток видно" from public.test_attempts;
select count(*) as "чужого прогресса видно" from public.user_progress;
-- 6. аноним видит структуру, но не непроверенное
set role anon; select set_config('request.jwt.claim.sub', '', false);
select count(*) as "тем видит аноним" , (select count(*) from public.questions) as "вопросов видит аноним" from public.topics;
-- 7. удаление аккаунта студента каскадом удаляет его данные
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.delete_my_account();
reset role;
select (select count(*) from auth.users) as users, (select count(*) from public.test_attempts) as attempts, (select count(*) from public.user_progress) as progress;
