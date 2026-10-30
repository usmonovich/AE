#!/usr/bin/env bash
# Проверка миграций и RLS на настоящем Postgres 16 (без Docker): initdb во временной папке.
set -euo pipefail
cd "$(dirname "$0")/../.."
PG=/usr/lib/postgresql/16/bin
DIR=$(mktemp -d); PORT=55432
chown -R postgres "$DIR" 2>/dev/null || true
run() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
run "$PG/initdb -D $DIR/data -U postgres >/dev/null"
run "$PG/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log start >/dev/null"
trap 'run "$PG/pg_ctl -D $DIR/data stop -m fast >/dev/null"; rm -rf $DIR' EXIT
sleep 1
PSQL="$PG/psql -h $DIR -p $PORT -U postgres -d postgres -q -X"
# миграции: схема и предметы (0002 повторно — проверка, что повторный запуск безопасен)
run "$PSQL -f tests/db/auth-stub.sql"
run "$PSQL -v ON_ERROR_STOP=1 -f supabase/migrations/0001_schema.sql"
run "$PSQL -v ON_ERROR_STOP=1 -f supabase/migrations/0002_subjects.sql"
run "$PSQL -v ON_ERROR_STOP=1 -f supabase/migrations/0002_subjects.sql"
# тестовые предметы (tests/fixtures/content): А — утверждаем два вопроса, Б — один, как сделал бы администратор
load() { # load <pack.json> <таблица> <число утверждённых вопросов>
  node -e "const p=require('./$1');for(let i=0;i<$3;i++)p.questions[i].status='approved';require('fs').writeFileSync('$DIR/$2.json',JSON.stringify(p))"
  chmod 644 $DIR/$2.json; cp $DIR/$2.json /tmp/ae_$2.json; chmod 644 /tmp/ae_$2.json
  run "$PSQL -c \"create table public.$2(p jsonb); copy public.$2 from '/tmp/ae_$2.json' with (format csv, quote E'\\\\x01', delimiter E'\\\\x02'); grant select on public.$2 to authenticated, anon;\"" >/dev/null
}
load tests/fixtures/content/subjects/alpha/pack.json tmp_pack 2
run "$PSQL -f tests/db/rls-test.sql"
run "$PSQL -f tests/db/rls-test2.sql"
load tests/fixtures/content/subjects/beta/pack.json tmp_beta_pack 1
run "$PSQL -c \"insert into auth.users values ('00000000-0000-0000-0000-00000000000c', 'student2@example.com');\"" >/dev/null
run "$PSQL -f tests/db/subjects-test.sql"
