\set ON_ERROR_STOP on
-- Несколько предметов в одной базе: предмет А уже опубликован, предмет Б публикуется отдельно и А не затрагивает.
create temp table before_b as
  select (select count(*) from public.questions) q, (select count(*) from public.theories) t, (select count(*) from public.topics) tp,
         (select count(*) from public.content_versions) v;
select (select count(*) from public.sections where subject = 'alpha') = (select count(*) from public.sections) as "все разделы — предмета А";
select (select count(*) from public.content_versions where subject = 'alpha') = (select count(*) from public.content_versions) as "версии помечены предметом А";

-- администратор публикует предмет Б
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.publish_content_pack((select p from public.tmp_beta_pack)) as "опубликована версия предмета Б";
-- студент не может публиковать
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin perform public.publish_content_pack((select p from public.tmp_beta_pack)); raise exception 'FAIL: студент опубликовал предмет Б'; exception when insufficient_privilege then raise notice 'OK: студенту публикация запрещена'; end $$;
reset role;

-- пакет с неизвестным предметом (не id из реестра) не публикуется
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin perform public.publish_content_pack((select p || jsonb_build_object('course', jsonb_build_object('id', 'Bad Id!')) from public.tmp_beta_pack)); raise exception 'FAIL: опубликован пакет с неверным предметом'; exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK: неверный предмет отклонён'; end $$;
reset role;

do $$
declare b record;
begin
  select * into b from before_b;
  if (select count(*) from public.questions where id not like 'tb-%') <> b.q then raise exception 'FAIL: изменилось число вопросов предмета А'; end if;
  if (select count(*) from public.theories where id not like 'tb-%') <> b.t then raise exception 'FAIL: изменилось число блоков теории предмета А'; end if;
  if (select count(*) from public.topics where id not like 'tb-%') <> b.tp then raise exception 'FAIL: изменилось число тем предмета А'; end if;
  if (select count(*) from public.sections where subject = 'beta') <> 1 then raise exception 'FAIL: разделы предмета Б не помечены'; end if;
  if (select count(*) from public.sections where subject = 'alpha' and id like 'tb-%') > 0 then raise exception 'FAIL: раздел предмета Б помечен как А'; end if;
  if (select count(*) from public.content_versions where subject = 'beta') <> 1 then raise exception 'FAIL: нет версии предмета Б'; end if;
  if (select count(*) from public.content_versions where subject = 'alpha') <> b.v then raise exception 'FAIL: изменились версии предмета А'; end if;
  if (select count(*) from public.questions where id like 'tb-%') = 0 then raise exception 'FAIL: вопросы предмета Б не опубликованы'; end if;
  raise notice 'OK: предмет А не изменился, предмет Б опубликован отдельно';
end $$;

-- приложение каждого предмета берёт последнюю версию своего предмета
select (select pack -> 'course' ->> 'id' from public.content_versions where subject = 'alpha' order by published_at desc limit 1) = 'alpha' as "последняя версия А — предмет А",
       (select pack -> 'course' ->> 'id' from public.content_versions where subject = 'beta' order by published_at desc limit 1) = 'beta' as "версия Б — предмет Б";

-- прогресс по разным предметам хранится в тех же таблицах и виден только владельцу
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
insert into public.user_progress (user_id, topic_id, studied_at) values (auth.uid(), 'tb-1-1-1', now()), (auth.uid(), 'ta-speed', now());
select count(*) filter (where topic_id like 'tb-%') as "тем предмета Б у студента", count(*) filter (where topic_id like 'ta-%') as "тем предмета А у студента" from public.user_progress;
reset role;
