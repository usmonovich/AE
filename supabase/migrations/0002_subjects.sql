-- 0002: несколько предметов в одной базе (приложение AE).
-- Каждая учебная запись и опубликованная версия помечается предметом (id из content/subjects.json, например 'crm').
-- ID тем и записей у каждого предмета начинаются с его префикса («crm-…», «ct-…»), поэтому прогресс,
-- попытки, избранное и очередь ошибок хранятся в общих таблицах без пересечений.
-- Повторный запуск безопасен.

alter table public.sections add column if not exists subject text not null default '';
alter table public.source_files add column if not exists subject text not null default '';
alter table public.content_versions add column if not exists subject text not null default '';
alter table public.sections alter column subject drop default;
alter table public.source_files alter column subject drop default;
alter table public.content_versions alter column subject drop default;
do $$ begin
  alter table public.sections add constraint sections_subject_chk check (subject ~ '^[a-z][a-z0-9]{1,23}$');
  alter table public.source_files add constraint source_files_subject_chk check (subject ~ '^[a-z][a-z0-9]{1,23}$');
  alter table public.content_versions add constraint content_versions_subject_chk check (subject ~ '^[a-z][a-z0-9]{1,23}$');
exception when duplicate_object then null; end $$;
create index if not exists content_versions_subject_idx on public.content_versions (subject, published_at desc);
-- номер версии уникален в пределах предмета: учебные базы разных предметов, собранные в одну секунду,
-- получают одинаковый номер и не должны перезаписывать друг друга
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'content_versions_pkey'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (version)') then
    alter table public.content_versions drop constraint content_versions_pkey;
    alter table public.content_versions add constraint content_versions_pkey primary key (subject, version);
  end if;
end $$;

-- Публикация: предмет берётся из пакета (course.id), опубликованная версия помечается предметом —
-- приложение загружает последнюю версию своего предмета (select … where subject = …).
create or replace function public.publish_content_pack(p_pack jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_version text := p_pack ->> 'version'; v_subject text := p_pack -> 'course' ->> 'id'; q jsonb; o jsonb; i int;
begin
  if not public.is_admin() then raise exception 'Только администратор может публиковать учебную базу' using errcode = '42501'; end if;
  if (p_pack ->> 'schema')::int is distinct from 1 then raise exception 'Неверный формат пакета'; end if;
  if v_subject is null or v_subject !~ '^[a-z][a-z0-9]{1,23}$' then raise exception 'Неизвестный предмет: %', v_subject; end if;

  insert into sections (id, title, sort_order, status, subject)
    select x ->> 'id', x ->> 'title', (x ->> 'order')::int, x ->> 'status', v_subject from jsonb_array_elements(p_pack -> 'sections') x
  on conflict (id) do update set title = excluded.title, sort_order = excluded.sort_order, status = excluded.status, subject = excluded.subject;
  insert into subsections (id, section_id, title, sort_order, note)
    select x ->> 'id', x ->> 'sectionId', x ->> 'title', (x ->> 'order')::int, x ->> 'note' from jsonb_array_elements(p_pack -> 'subsections') x
  on conflict (id) do update set section_id = excluded.section_id, title = excluded.title, sort_order = excluded.sort_order, note = excluded.note;
  insert into topics (id, subsection_id, title, sort_order, pages, status)
    select x ->> 'id', x ->> 'subsectionId', x ->> 'title', (x ->> 'order')::int, array(select jsonb_array_elements_text(x -> 'pages')), x ->> 'status'
    from jsonb_array_elements(p_pack -> 'topics') x
  on conflict (id) do update set subsection_id = excluded.subsection_id, title = excluded.title, sort_order = excluded.sort_order, pages = excluded.pages, status = excluded.status;

  insert into source_files (id, title, file_name, kind, sha256, pages_total, import_status, note, subject)
    select x ->> 'id', x ->> 'title', x ->> 'fileName', x ->> 'kind', x ->> 'sha256', (x ->> 'pdfPages')::int, 'processed', x ->> 'note', v_subject
    from jsonb_array_elements(p_pack -> 'sourceFiles') x
  on conflict (id) do update set title = excluded.title, sha256 = excluded.sha256, pages_total = excluded.pages_total, subject = excluded.subject;
  insert into source_pages (file_id, page_ref, pdf_page, side, image_path, page_date, sort_index)
    select x ->> 'file', x ->> 'ref', (x ->> 'pdfPage')::int, x ->> 'side', x ->> 'image', x ->> 'date', (x ->> 'index')::int
    from jsonb_array_elements(p_pack -> 'pages') x
  on conflict (file_id, page_ref) do update set image_path = excluded.image_path, page_date = excluded.page_date, sort_index = excluded.sort_index;

  insert into theories (id, topic_id, kind, title, body_md, source_refs, source_order, status, errata, content_hash)
    select x ->> 'id', x ->> 'topicId', x ->> 'kind', x ->> 'title', x ->> 'body', x -> 'sources', (x ->> 'sourceOrder')::int,
      (x ->> 'status')::content_status, array(select jsonb_array_elements_text(coalesce(x -> 'errata', '[]'))), x ->> 'hash'
    from jsonb_array_elements(p_pack -> 'theory') x
  on conflict (id) do update set title = excluded.title, body_md = excluded.body_md, status = excluded.status, errata = excluded.errata, content_hash = excluded.content_hash, topic_id = excluded.topic_id;
  insert into formulas (id, topic_id, title, latex, symbols, conditions, boxed, needs_manual_check, source_refs, source_order, status, errata, content_hash)
    select x ->> 'id', x ->> 'topicId', x ->> 'title', x ->> 'tex', array(select jsonb_array_elements_text(x -> 'symbols')), x ->> 'conditions',
      (x ->> 'boxed')::boolean, (x ->> 'manualCheck')::boolean, x -> 'sources', (x ->> 'sourceOrder')::int, (x ->> 'status')::content_status,
      array(select jsonb_array_elements_text(coalesce(x -> 'errata', '[]'))), x ->> 'hash'
    from jsonb_array_elements(p_pack -> 'formulas') x
  on conflict (id) do update set title = excluded.title, latex = excluded.latex, conditions = excluded.conditions, needs_manual_check = excluded.needs_manual_check, status = excluded.status, errata = excluded.errata, topic_id = excluded.topic_id;
  insert into examples (id, topic_id, title, given, steps, answer, computed, source_refs, source_order, status, errata, content_hash)
    select x ->> 'id', x ->> 'topicId', x ->> 'title', x ->> 'given', x -> 'steps', x ->> 'answer', coalesce((x ->> 'computed')::boolean, false),
      x -> 'sources', (x ->> 'sourceOrder')::int, (x ->> 'status')::content_status, array(select jsonb_array_elements_text(coalesce(x -> 'errata', '[]'))), x ->> 'hash'
    from jsonb_array_elements(p_pack -> 'examples') x
  on conflict (id) do update set title = excluded.title, steps = excluded.steps, answer = excluded.answer, status = excluded.status, topic_id = excluded.topic_id;

  for q in select value from jsonb_array_elements(p_pack -> 'questions') loop
    insert into questions (id, topic_id, type, category, prompt, generated, source_refs, source_order, status, formula_ids, content_hash, updated_at)
    values (q ->> 'id', q ->> 'topicId', q ->> 'type', q ->> 'category', q ->> 'prompt', (q ->> 'generated')::boolean, q -> 'sources',
      (q ->> 'sourceOrder')::int, (q ->> 'status')::content_status, array(select jsonb_array_elements_text(q -> 'formulaIds')), q ->> 'hash', now())
    on conflict (id) do update set topic_id = excluded.topic_id, prompt = excluded.prompt, status = excluded.status, formula_ids = excluded.formula_ids,
      content_hash = excluded.content_hash, source_order = excluded.source_order, updated_at = now();
    delete from answer_options where question_id = q ->> 'id';
    for o in select value from jsonb_array_elements(coalesce(q -> 'options', '[]')) loop
      insert into answer_options (question_id, key, body) values (q ->> 'id', o ->> 'key', o ->> 'body');
    end loop;
    insert into correct_answers (question_id, value, numeric_value, unit, tolerance, tolerance_abs, check_expr)
    values (q ->> 'id', coalesce(q -> 'answer', q -> 'pairs', q -> 'sequence', to_jsonb(q ->> 'reference'), 'null'::jsonb),
      (q -> 'numeric' ->> 'value')::float8, q -> 'numeric' ->> 'unit', (q -> 'numeric' ->> 'tol')::float8, (q -> 'numeric' ->> 'tolAbs')::float8, q -> 'numeric' ->> 'check')
    on conflict (question_id) do update set value = excluded.value, numeric_value = excluded.numeric_value, unit = excluded.unit,
      tolerance = excluded.tolerance, tolerance_abs = excluded.tolerance_abs, check_expr = excluded.check_expr;
    insert into explanations (question_id, body_md, solution) values (q ->> 'id', q ->> 'explanation', q -> 'solution')
    on conflict (question_id) do update set body_md = excluded.body_md, solution = excluded.solution;
    delete from hints where question_id = q ->> 'id';
    i := 0;
    for o in select value from jsonb_array_elements(q -> 'hints') loop
      i := i + 1;
      insert into hints (question_id, level, body_md) values (q ->> 'id', i, o #>> '{}');
    end loop;
  end loop;

  insert into errata (id, page_ref, severity, original, issue, suggestion, resolution)
    select x ->> 'id', x ->> 'page', x ->> 'severity', x ->> 'original', x ->> 'issue', x ->> 'suggestion', coalesce(x ->> 'resolution', 'open')
    from jsonb_array_elements(p_pack -> 'errata') x
  on conflict (id) do update set resolution = excluded.resolution, original = excluded.original, issue = excluded.issue, suggestion = excluded.suggestion;

  -- публичная версия для приложений студентов
  insert into content_versions (version, pack, published_by, subject)
  values (v_version,
    p_pack
      || jsonb_build_object('questions', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'questions') x where x ->> 'status' = 'approved'), '[]'))
      || jsonb_build_object('theory', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'theory') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('formulas', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'formulas') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('examples', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'examples') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('builtAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    auth.uid(), v_subject)
  on conflict (subject, version) do update set pack = excluded.pack, published_at = now(), published_by = excluded.published_by;
  insert into processing_log (level, message) values ('info', 'Опубликована версия ' || v_version || ' (' || v_subject || ')');
  return v_version;
end $$;

