-- Схема учебной базы приложения AE для Supabase (Postgres 15+). Предметы добавляет миграция 0002.
-- Учебная база (таблицы content) + прогресс пользователей + RLS + серверные функции.
-- Применение: supabase db push  (или вставить в SQL Editor проекта).

create extension if not exists pgcrypto;

-- ───────────── профили и роли ─────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  role text not null default 'student' check (role in ('student', 'admin')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────── структура курса ─────────────
create table if not exists public.sections (
  id text primary key, title text not null, sort_order int not null default 0,
  status text not null default 'active' check (status in ('active', 'planned'))
);
create table if not exists public.subsections (
  id text primary key, section_id text not null references public.sections (id) on delete cascade,
  title text not null, sort_order int not null default 0, note text
);
create table if not exists public.topics (
  id text primary key, subsection_id text not null references public.subsections (id) on delete restrict,
  title text not null, sort_order int not null default 0, pages text[] not null default '{}',
  status text not null default 'review' check (status in ('draft', 'review', 'approved', 'rejected'))
);

-- ───────────── источники ─────────────
create table if not exists public.source_files (
  id text primary key, title text not null, file_name text not null, kind text not null,
  sha256 text unique, pages_total int, storage_path text,
  import_status text not null default 'registered' check (import_status in ('registered', 'processing', 'processed', 'failed')),
  imported_at timestamptz default now(), note text
);
create table if not exists public.source_pages (
  id bigint generated always as identity primary key,
  file_id text not null references public.source_files (id) on delete cascade,
  page_ref text not null, pdf_page int not null, side text not null default '', image_path text,
  page_date text, sort_index int not null, readable boolean not null default true, ocr_confidence real,
  unique (file_id, page_ref)
);
create table if not exists public.source_fragments (
  id bigint generated always as identity primary key,
  page_id bigint not null references public.source_pages (id) on delete cascade,
  text text not null, bbox jsonb
);

-- ───────────── учебные записи ─────────────
create type public.content_status as enum ('draft', 'review', 'approved', 'rejected');

create table if not exists public.theories (
  id text primary key, topic_id text not null references public.topics (id) on delete cascade,
  kind text not null, title text, body_md text not null,
  source_refs jsonb not null, source_order int not null, status public.content_status not null default 'review',
  errata text[], content_hash text not null
);
create table if not exists public.formulas (
  id text primary key, topic_id text not null references public.topics (id) on delete cascade,
  title text not null, latex text not null, symbols text[] not null default '{}', conditions text,
  boxed boolean not null default false, needs_manual_check boolean not null default false,
  source_refs jsonb not null, source_order int not null, status public.content_status not null default 'review',
  errata text[], content_hash text not null
);
create table if not exists public.examples (
  id text primary key, topic_id text not null references public.topics (id) on delete cascade,
  title text not null, given text, steps jsonb not null, answer text, computed boolean not null default false,
  source_refs jsonb not null, source_order int not null, status public.content_status not null default 'review',
  errata text[], content_hash text not null
);
create table if not exists public.questions (
  id text primary key, topic_id text not null references public.topics (id) on delete cascade,
  type text not null check (type in ('single', 'multiple', 'numeric', 'matching', 'sequence', 'text')),
  category text not null check (category in ('theory', 'formula', 'problem')),
  prompt text not null, generated boolean not null default false,
  source_refs jsonb not null, source_order int not null, status public.content_status not null default 'review',
  formula_ids text[] not null default '{}', content_hash text not null unique,
  updated_at timestamptz not null default now()
);
create table if not exists public.answer_options (
  question_id text not null references public.questions (id) on delete cascade,
  key text not null, body text not null, primary key (question_id, key)
);
create table if not exists public.correct_answers (
  question_id text primary key references public.questions (id) on delete cascade,
  value jsonb not null,           -- ключ(и), пары, порядок, эталонный текст
  numeric_value double precision, unit text, tolerance double precision, tolerance_abs double precision, check_expr text
);
create table if not exists public.explanations (
  question_id text primary key references public.questions (id) on delete cascade,
  body_md text not null, solution jsonb
);
create table if not exists public.hints (
  question_id text not null references public.questions (id) on delete cascade,
  level int not null default 1, body_md text not null, primary key (question_id, level)
);
create table if not exists public.errata (
  id text primary key, page_ref text not null, severity text not null,
  original text not null, issue text not null, suggestion text not null,
  resolution text not null default 'open' check (resolution in ('open', 'accepted', 'kept'))
);
create table if not exists public.content_versions (
  version text primary key, pack jsonb not null, published_at timestamptz not null default now(),
  published_by uuid references auth.users (id) on delete set null
);
create table if not exists public.processing_log (
  id bigint generated always as identity primary key, file_id text references public.source_files (id) on delete cascade,
  level text not null default 'info', message text not null, created_at timestamptz not null default now()
);

-- ───────────── прогресс пользователей ─────────────
create table if not exists public.user_progress (
  user_id uuid not null references auth.users (id) on delete cascade, topic_id text not null,
  studied_at timestamptz, last_opened_at timestamptz, primary key (user_id, topic_id)
);
create table if not exists public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  entity_type text not null check (entity_type in ('question', 'formula', 'topic')), entity_id text not null,
  added_at timestamptz not null default now(), primary key (user_id, entity_type, entity_id)
);
create table if not exists public.test_configurations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
  name text not null, config jsonb not null, created_at timestamptz not null default now()
);
create table if not exists public.test_attempts (
  id text primary key, user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null, title text not null, config jsonb not null, question_ids text[] not null, seed bigint not null,
  started_at timestamptz not null, finished_at timestamptz, deadline_at timestamptz, parent_id text,
  current_index int not null default 0, score_percent int
);
create table if not exists public.attempt_answers (
  attempt_id text not null references public.test_attempts (id) on delete cascade, question_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null, tries int not null default 0, hint_used boolean not null default false,
  solution_shown boolean not null default false, correct boolean, responses jsonb not null default '[]'::jsonb,
  answered_at timestamptz, primary key (attempt_id, question_id)
);
create table if not exists public.error_review_queue (
  user_id uuid not null references auth.users (id) on delete cascade, question_id text not null,
  wrong_count int not null default 1, last_wrong_at timestamptz not null, correct_streak int not null default 0,
  primary key (user_id, question_id)
);
create table if not exists public.user_question_stats (
  user_id uuid not null references auth.users (id) on delete cascade, question_id text not null,
  seen int not null default 0, correct int not null default 0, wrong int not null default 0, last_at timestamptz,
  primary key (user_id, question_id)
);

create index if not exists questions_topic_idx on public.questions (topic_id, source_order);
create index if not exists attempts_user_idx on public.test_attempts (user_id, started_at desc);
create index if not exists answers_user_idx on public.attempt_answers (user_id);

-- ───────────── Row Level Security ─────────────
alter table public.profiles enable row level security;
create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from public.profiles p where p.id = auth.uid())); -- роль сам себе не поднять

do $$
declare t text;
begin
  -- структура и замечания: читать могут все, менять — только администратор
  foreach t in array array['sections', 'subsections', 'topics', 'errata', 'content_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
  -- учебные записи: студент видит только утверждённое
  foreach t in array array['theories', 'formulas', 'examples', 'questions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (status = ''approved'' or public.is_admin())', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
  -- части вопроса наследуют видимость вопроса
  foreach t in array array['answer_options', 'correct_answers', 'explanations', 'hints'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.questions q where q.id = question_id and (q.status = ''approved'' or public.is_admin())))', t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
  -- источники и журнал обработки — только администратор
  foreach t in array array['source_files', 'source_pages', 'source_fragments', 'processing_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
  -- прогресс: каждый пользователь — только свои строки
  foreach t in array array['user_progress', 'bookmarks', 'test_configurations', 'test_attempts', 'attempt_answers', 'error_review_queue', 'user_question_stats'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
  end loop;
end $$;

-- ───────────── публикация учебной базы ─────────────
-- Принимает полный пакет (как content/pack.json), раскладывает по таблицам и сохраняет
-- публичную версию: вопросы — только утверждённые, остальное — кроме отклонённого.
create or replace function public.publish_content_pack(p_pack jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare v_version text := p_pack ->> 'version'; q jsonb; o jsonb; i int;
begin
  if not public.is_admin() then raise exception 'Только администратор может публиковать учебную базу' using errcode = '42501'; end if;
  if (p_pack ->> 'schema')::int is distinct from 1 then raise exception 'Неверный формат пакета'; end if;

  insert into sections (id, title, sort_order, status)
    select x ->> 'id', x ->> 'title', (x ->> 'order')::int, x ->> 'status' from jsonb_array_elements(p_pack -> 'sections') x
  on conflict (id) do update set title = excluded.title, sort_order = excluded.sort_order, status = excluded.status;
  insert into subsections (id, section_id, title, sort_order, note)
    select x ->> 'id', x ->> 'sectionId', x ->> 'title', (x ->> 'order')::int, x ->> 'note' from jsonb_array_elements(p_pack -> 'subsections') x
  on conflict (id) do update set section_id = excluded.section_id, title = excluded.title, sort_order = excluded.sort_order, note = excluded.note;
  insert into topics (id, subsection_id, title, sort_order, pages, status)
    select x ->> 'id', x ->> 'subsectionId', x ->> 'title', (x ->> 'order')::int, array(select jsonb_array_elements_text(x -> 'pages')), x ->> 'status'
    from jsonb_array_elements(p_pack -> 'topics') x
  on conflict (id) do update set subsection_id = excluded.subsection_id, title = excluded.title, sort_order = excluded.sort_order, pages = excluded.pages, status = excluded.status;

  insert into source_files (id, title, file_name, kind, sha256, pages_total, import_status, note)
    select x ->> 'id', x ->> 'title', x ->> 'fileName', x ->> 'kind', x ->> 'sha256', (x ->> 'pdfPages')::int, 'processed', x ->> 'note'
    from jsonb_array_elements(p_pack -> 'sourceFiles') x
  on conflict (id) do update set title = excluded.title, sha256 = excluded.sha256, pages_total = excluded.pages_total;
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
  insert into content_versions (version, pack, published_by)
  values (v_version,
    p_pack
      || jsonb_build_object('questions', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'questions') x where x ->> 'status' = 'approved'), '[]'))
      || jsonb_build_object('theory', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'theory') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('formulas', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'formulas') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('examples', coalesce((select jsonb_agg(x) from jsonb_array_elements(p_pack -> 'examples') x where x ->> 'status' <> 'rejected'), '[]'))
      || jsonb_build_object('builtAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    auth.uid())
  on conflict (version) do update set pack = excluded.pack, published_at = now(), published_by = excluded.published_by;
  insert into processing_log (level, message) values ('info', 'Опубликована версия ' || v_version);
  return v_version;
end $$;

revoke all on function public.publish_content_pack(jsonb) from public, anon;
grant execute on function public.publish_content_pack(jsonb) to authenticated;

-- ───────────── удаление аккаунта ─────────────
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'Требуется вход' using errcode = '42501'; end if;
  delete from auth.users where id = auth.uid(); -- каскадом удаляются профиль, прогресс, попытки, избранное
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Права для ролей PostgREST (в Supabase роли anon/authenticated уже существуют)
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
