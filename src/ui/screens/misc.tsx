// Настройки, аккаунт и синхронизация, поиск, политика конфиденциальности.

import { SaveState } from '../components/save-state';
import { useRef, useState } from 'react';
import { useIndex, useAdmin, useSettings, useSubject, runtimes, pack } from '../../data/store';
import { ADMIN_ENABLED } from '../../data/build-flags';
import { SUBJECTS, SUBJECT_IDS, APP_TITLE, subjectOfId } from '../../data/subjects';
import { setSettings, resetProgress, exportProgress, importProgress } from '../../data/actions';
import { supabase, backendEnabled } from '../../data/supabase';
import { syncNow, lastSyncAt } from '../../data/sync';
import { search } from '../../domain/search';
import { Topbar, Link, Button, Switch, Segmented, Confirm, Notice, Empty, Badge, toast, tryDownload, copyText, fmtDate } from '../components/ui';
import { Icon } from '../components/Icon';
import { Rich, Tex } from '../components/Rich';

/** Синхронизация с сервером идёт сразу по всем предметам: ID у них не пересекаются (у каждого предмета свой префикс «<prefix>-»). */
const syncTargets = () => SUBJECT_IDS.map((id) => ({
  get: runtimes[id].userStore.get, set: runtimes[id].userStore.set,
  owns: (x: string) => subjectOfId(x) === id,
}));

export function SettingsScreen() {
  const s = useSettings();
  const meta = useSubject();
  const [confirm, setConfirm] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const exportRef = useRef<HTMLTextAreaElement>(null);
  const doImport = (text: string) => {
    const r = importProgress(text);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setImportText('');
  };
  return (
    <div className="screen">
      <Topbar title="Настройки" sub={`${APP_TITLE} · ${meta.short}`} backTo="" />
      <div className="pad stack">
        <section className="card">
          <h2>Предмет</h2>
          <p>Сейчас открыт предмет «{meta.title}». Прогресс, тесты, избранное и очередь ошибок у предметов раздельные; настройки ниже — общие.</p>
          <a className="row" href="#/"><span className="row-main"><b>Сменить предмет</b><span className="muted">{SUBJECT_IDS.map((id) => SUBJECTS[id].short).join(' · ')}</span></span><Icon name="next" /></a>
        </section>
        <section className="card">
          <h2>Внешний вид</h2>
          <p className="label">Тема</p>
          <Segmented label="Тема оформления" value={s.theme} onChange={(v) => setSettings({ theme: v })} options={[{ value: 'system', label: 'Как в системе' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]} />
          <p className="label">Размер текста</p>
          <Segmented label="Размер текста" value={String(s.fontScale) as '1' | '1.15' | '1.3'} onChange={(v) => setSettings({ fontScale: Number(v) })} options={[{ value: '1', label: 'Обычный' }, { value: '1.15', label: 'Крупный' }, { value: '1.3', label: 'Очень крупный' }]} />
        </section>

        <section className="card">
          <h2>Учебные материалы</h2>
          {ADMIN_ENABLED ? <Switch id="show-review" checked={s.showReviewContent} onChange={(v) => setSettings({ showReviewContent: v })} label="Показывать теорию и формулы на проверке" hint="Записи, ещё не утверждённые администратором, помечены «на проверке». Непроверенные вопросы в тесты не попадают. Настройка действует для всех предметов." /> : null}
        </section>

        <section className="card">
          <h2>Аккаунт и синхронизация</h2>
          <AccountBlock />
        </section>

        <section className="card">
          <h2>Мои данные: {meta.title}</h2>
          <SaveState scope="user" />
          <div className="row-actions wrap">
            <Button kind="secondary" icon="download" onClick={() => { const t = exportProgress(); setExportText(t); tryDownload(`progress-${meta.id}-${new Date().toISOString().slice(0, 10)}.json`, t); }}>Экспорт прогресса</Button>
            <label className="btn btn-secondary file-btn">
              <Icon name="upload" size={18} />
              <span>Импорт из файла</span>
              <input type="file" accept="application/json,.json" id="import-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) doImport(await f.text()); e.target.value = ''; }} />
            </label>
          </div>
          {exportText ? (
            <div className="export-box">
              <p className="muted small">Если файл не скачался, скопируйте текст и сохраните его.</p>
              <textarea ref={exportRef} readOnly rows={4} value={exportText} id="export-text" />
              <Button small kind="secondary" icon="copy" onClick={async () => toast((await copyText(exportText, exportRef.current)) ? 'Скопировано' : 'Текст выделен — скопируйте вручную')}>Скопировать</Button>
            </div>
          ) : null}
          <details>
            <summary>Вставить резервную копию текстом</summary>
            <textarea rows={3} value={importText} onChange={(e) => setImportText(e.target.value)} id="import-text" placeholder={`{"kind":"${meta.exportKind}",…}`} />
            <Button small kind="secondary" disabled={!importText.trim()} onClick={() => doImport(importText)}>Восстановить</Button>
          </details>
          {msg ? <Notice tone={msg.ok ? 'ok' : 'bad'}>{msg.text}</Notice> : null}
          <hr />
          <Button kind="danger" icon="trash" onClick={() => setConfirm(true)}>Сбросить прогресс</Button>
          <p className="muted small">Удаляются отметки «изучено», история тестов, избранное и очередь ошибок по предмету «{meta.title}» на этом устройстве. Другие предметы и учебная база не меняются.</p>
        </section>

        {ADMIN_ENABLED ? (
          <section className="card">
            <h2>Администрирование</h2>
            <Link to="admin" className="row"><span className="row-main"><b>Админ-панель</b><span className="muted">Проверка и утверждение материалов по предмету «{meta.title}», структура, публикация</span></span><Icon name="next" /></Link>
          </section>
        ) : null}

        <section className="card about">
          <h2>О приложении</h2>
          <p>{APP_TITLE} · версия 1.0.0 · учебная база «{meta.title}» {pack.version}</p>
          {pack.sourceFiles.map((f) => <p key={f.id}>Источник: «{meta.style === 'book' ? f.title : f.fileName}», {pack.pages.filter((p) => p.file === f.id).length} стр.</p>)}
          <p><Link to="privacy">Политика конфиденциальности</Link></p>
        </section>
      </div>
      <Confirm open={confirm} title={`Сбросить прогресс по предмету «${meta.title}»?`} danger confirmText="Сбросить" requireText="СБРОС" onCancel={() => setConfirm(false)} onConfirm={() => { resetProgress(); setConfirm(false); toast('Прогресс сброшен'); }}>
        <p>Это действие нельзя отменить. Сначала можно сделать экспорт прогресса.</p>
      </Confirm>
    </div>
  );
}

function AccountBlock() {
  const client = supabase();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [del, setDel] = useState(false);
  const [, force] = useState(0);
  if (!backendEnabled() || !client) {
    return (
      <>
        <p>Прогресс хранится только на этом устройстве. Вход и синхронизация между устройствами включаются, когда приложение собрано с подключённым сервером Supabase.</p>
        <p className="muted small">Для администратора: инструкция — docs/06-backend-setup.md.</p>
      </>
    );
  }
  const session = client.session();
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message || 'Нет связи с сервером. Прогресс сохранён на устройстве.' });
    } finally {
      setBusy(false);
      force((x) => x + 1);
    }
  };
  if (session) {
    const last = lastSyncAt();
    return (
      <>
        <p>Вы вошли как <b>{session.user.email}</b>.</p>
        <p className="muted small">{last ? `Последняя синхронизация: ${fmtDate(last)}` : 'Синхронизации ещё не было.'}</p>
        <div className="row-actions wrap">
          <Button icon="sync" disabled={busy} onClick={() => run(async () => { await syncNow(client, syncTargets()); return 'Прогресс синхронизирован.'; })}>Синхронизировать</Button>
          <Button kind="secondary" disabled={busy} onClick={() => run(async () => { await client.signOut(); return 'Вы вышли из аккаунта. Прогресс на устройстве сохранён.'; })}>Выйти</Button>
          <Button kind="ghost" onClick={() => setDel(true)}>Удалить аккаунт</Button>
        </div>
        {msg ? <Notice tone={msg.ok ? 'ok' : 'bad'}>{msg.text}</Notice> : null}
        <Confirm open={del} danger title="Удалить аккаунт?" confirmText="Удалить навсегда" requireText="УДАЛИТЬ" onCancel={() => setDel(false)} onConfirm={() => { setDel(false); run(async () => { await client.rpc('delete_my_account'); await client.signOut(); return 'Аккаунт и данные на сервере удалены.'; }); }}>
          <p>С сервера будут удалены аккаунт, прогресс, история тестов и избранное. Данные на этом устройстве останутся, пока вы их не сбросите.</p>
        </Confirm>
      </>
    );
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => {
      if (mode === 'in') { await client.signIn(email.trim(), password); await syncNow(client, syncTargets()); return 'Вход выполнен, прогресс синхронизирован.'; }
      const r = await client.signUp(email.trim(), password);
      return r.confirmationRequired ? 'Аккаунт создан. Подтвердите email по ссылке из письма и войдите.' : 'Аккаунт создан.';
    }); }}>
      <Segmented label="Вход или регистрация" value={mode} onChange={setMode} options={[{ value: 'in', label: 'Вход' }, { value: 'up', label: 'Регистрация' }]} />
      <label className="field" htmlFor="auth-email"><span>Email</span><input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field" htmlFor="auth-password"><span>Пароль (не короче 8 символов)</span><input id="auth-password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <Button type="submit" disabled={busy}>{mode === 'in' ? 'Войти' : 'Зарегистрироваться'}</Button>
      {msg ? <Notice tone={msg.ok ? 'ok' : 'bad'}>{msg.text}</Notice> : null}
      <p className="muted small">Храним только email и учебный прогресс. Подробнее — в <Link to="privacy">политике конфиденциальности</Link>.</p>
    </form>
  );
}

export function SearchScreen() {
  const idx = useIndex();
  const settings = useSettings();
  const admin = useAdmin();
  const [q, setQ] = useState('');
  const hits = q.trim().length >= 2 ? search(idx, q, { showReview: settings.showReviewContent, includeReviewQuestions: admin.previewReview }) : [];
  const groups: { kind: string; title: string }[] = [
    { kind: 'topic', title: 'Темы' }, { kind: 'formula', title: 'Формулы' }, { kind: 'theory', title: 'Теория' }, { kind: 'question', title: 'Вопросы' },
  ];
  return (
    <div className="screen">
      <Topbar title="Поиск" backTo="" />
      <div className="pad stack">
        <label className="field search-field" htmlFor="search-input">
          <span className="sr-only">Поиск</span>
          <Icon name="search" />
          <input id="search-input" type="search" autoFocus placeholder="Тема, формула, слово из вопроса" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {q.trim().length >= 2 && !hits.length ? <Empty icon="search" title="Ничего не найдено">Попробуйте другое слово, например «импульс» или «υ₀».</Empty> : null}
        {groups.map((g) => {
          const list = hits.filter((h) => h.kind === g.kind);
          if (!list.length) return null;
          return (
            <section key={g.kind} className="block">
              <h2 className="label">{g.title} · {list.length}</h2>
              <ul className="list">
                {list.slice(0, 20).map((h) => (
                  <li key={h.kind + h.id}>
                    <Link to={h.kind === 'topic' ? `topic/${h.id}` : h.kind === 'formula' ? `topic/${h.topicId}/formulas` : h.kind === 'question' ? `topic/${h.topicId}/check` : `topic/${h.topicId}`} className="row">
                      <span className="row-main">
                        <b><Rich inline text={h.title} /></b>
                        {h.kind === 'formula' ? <Tex tex={h.snippet} /> : <span className="muted"><Rich inline text={h.snippet} /></span>}
                      </span>
                      <Icon name="next" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <div className="screen">
      <Topbar title="Конфиденциальность" backTo="settings" />
      <div className="pad prose">
        <p className="muted small">Редакция от 30.10.2026. Перед публикацией в магазинах укажите в этом тексте контактный email и, если нужно, юридическое лицо.</p>
        <h2>Какие данные мы обрабатываем</h2>
        <ul>
          <li><b>Без аккаунта</b> — никакие данные не покидают устройство: прогресс, история тестов и избранное хранятся локально.</li>
          <li><b>С аккаунтом</b> — email (для входа) и учебный прогресс: отметки изученных тем, попытки тестов и ответы, избранное, очередь ошибок. Это нужно только для синхронизации между вашими устройствами.</li>
        </ul>
        <h2>Чего мы не делаем</h2>
        <ul>
          <li>Не используем рекламу, трекеры и сторонние SDK аналитики.</li>
          <li>Не продаём и не передаём данные третьим лицам. Хранение — у провайдера Supabase (обработчик данных).</li>
          <li>Не запрашиваем доступ к камере, микрофону, контактам и геолокации.</li>
        </ul>
        <h2>Ваши права</h2>
        <ul>
          <li>Удалить аккаунт и все данные на сервере — в «Настройки → Аккаунт → Удалить аккаунт».</li>
          <li>Удалить данные на устройстве — «Настройки → Сбросить прогресс».</li>
          <li>Выгрузить свои данные — «Настройки → Экспорт прогресса».</li>
        </ul>
        <h2>Безопасность</h2>
        <p>Соединение с сервером шифруется (HTTPS). Доступ к данным ограничен правилами на стороне сервера: каждый пользователь видит только свои записи.</p>
      </div>
    </div>
  );
}

export function StatusPill({ ok }: { ok: boolean }) {
  return <Badge tone={ok ? 'ok' : 'warn'}>{ok ? 'включено' : 'выключено'}</Badge>;
}
