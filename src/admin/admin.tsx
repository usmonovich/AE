// Административная панель: импорт, проверка и утверждение материалов, структура, публикация, резервные копии.
// Локальный режим: доступ по PIN на этом устройстве (защита от случайного входа, а не от злоумышленника —
// настоящая защита серверных данных обеспечивается ролью admin и правилами RLS в Supabase).

import { useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { useIndex, useAdmin, useSubject, pack } from '../data/store';
import { ADMIN_ENABLED } from '../data/build-flags';
import { ADMIN_PIN_SPEC } from '../data/admin-pin';
import * as A from '../data/admin-actions';
import { supabase, backendEnabled } from '../data/supabase';
import { normalizeLatex, normalizeMarkdownMath } from '../domain/latex';
import { pageLabel, labelPageRefs } from '../domain/page-label';
import type { ContentEntity } from '../domain/content-index';
import type { Example, Formula, Question, Status, Theory } from '../domain/types';
import { Topbar, Link, Button, Badge, Notice, Empty, Segmented, Switch, Confirm, Chip, toast, tryDownload, copyText, fmtDate, plural } from '../ui/components/ui';
import { Icon } from '../ui/components/Icon';
import { Rich, Tex } from '../ui/components/Rich';
import { Explanation, TYPE_LABEL } from '../ui/components/question';
import { ErratumCard, WebBadge, type ErratumResolution } from '../ui/components/content';
import { navigate } from '../ui/router';
import { SaveState } from '../ui/components/save-state';

let unlocked = false;
try {
  unlocked = sessionStorage.getItem('ae.admin.unlocked') === '1';
} catch {
  /* без sessionStorage — вход до перезагрузки */
}

export function AdminApp({ parts }: { parts: string[] }) {
  const [, setTick] = useState(0);
  if (!ADMIN_ENABLED) return <NoAdmin />;
  if (!unlocked) return <Gate onUnlock={() => { unlocked = true; try { sessionStorage.setItem('ae.admin.unlocked', '1'); } catch { /* */ } setTick((t) => t + 1); }} />;
  const [section, arg] = [parts[1] ?? '', parts[2]];
  switch (section) {
    case 'review': return <ReviewQueue />;
    case 'edit': return arg ? <Editor id={arg} /> : <ReviewQueue />;
    case 'errata': return <ErrataScreen />;
    case 'structure': return <StructureScreen />;
    case 'duplicates': return <Duplicates />;
    case 'sources': return <Sources page={arg} />;
    case 'publish': return <Publish />;
    case 'upload': return <Upload />;
    case 'log': return <LogScreen />;
    default: return <Dashboard />;
  }
}

/** В сборке для магазинов и сайта админ-панели нет. */
function NoAdmin() {
  return (
    <div className="screen">
      <Topbar title="Страница не найдена" backTo="" />
      <div className="pad"><Empty icon="search" title="Такой страницы нет">Вернитесь на главную.</Empty></div>
    </div>
  );
}

// Подбор PIN: после 5 неверных попыток подряд — пауза, каждая следующая неудача удваивает её (до 15 мин).
const LOCK_KEY = 'ae.admin.lock';
type Lock = { fails: number; until: number };
function readLock(): Lock {
  try { return { fails: 0, until: 0, ...JSON.parse(localStorage.getItem(LOCK_KEY) ?? '{}') }; } catch { return { fails: 0, until: 0 }; }
}
function writeLock(l: Lock) {
  try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch { /* без хранилища — только в памяти */ }
}

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen">
      <Topbar title="Админ-панель" backTo="" />
      <form className="pad stack narrow" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        const lock = readLock();
        const wait = Math.ceil((lock.until - Date.now()) / 1000);
        if (wait > 0) return setErr(`Слишком много неверных попыток. Подождите ${wait} с.`);
        if (!/^\d{4,12}$/.test(pin)) return setErr('PIN — от 4 до 12 цифр.');
        setBusy(true);
        const ok = await A.verifyPin(pin);
        setBusy(false);
        if (ok) { writeLock({ fails: 0, until: 0 }); onUnlock(); return; }
        const fails = lock.fails + 1;
        const pause = fails >= 5 ? Math.min(15 * 60, 30 * 2 ** (fails - 5)) : 0;
        writeLock({ fails, until: pause ? Date.now() + pause * 1000 : 0 });
        setPin('');
        setErr(pause ? `Неверный PIN. Следующая попытка — через ${pause} с.` : 'Неверный PIN.');
      }}>
        <Icon name="shield" size={32} />
        <h2>Введите PIN администратора</h2>
        <p className="muted small">Вход только для владельца приложения.</p>
        {!ADMIN_PIN_SPEC ? <Notice tone="warn">PIN администратора не задан в этой сборке: на компьютере владельца выполните <code>node tools/admin-pin.mjs --write</code> и пересоберите приложение.</Notice> : null}
        <label className="field" htmlFor="pin"><span>PIN</span><input id="pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {err ? <Notice tone="bad">{err}</Notice> : null}
        <Button type="submit" id="pin-submit" disabled={busy}>{busy ? 'Проверяю…' : 'Войти'}</Button>
      </form>
    </div>
  );
}

function AdminNav() {
  const items: [string, string, string][] = [
    ['admin', 'Обзор', 'layers'], ['admin/review', 'Проверка', 'check'], ['admin/errata', 'Замечания', 'flag'], ['admin/structure', 'Структура', 'list'],
    ['admin/sources', 'Источники', 'page'], ['admin/duplicates', 'Дубли', 'copy'], ['admin/upload', 'Загрузка', 'upload'], ['admin/publish', 'Публикация', 'download'], ['admin/log', 'Журнал', 'history'],
  ];
  return (
    <>
      <nav className="admin-nav" aria-label="Разделы админ-панели">
        {items.map(([to, label, icon]) => <Link key={to} to={to} className="admin-nav-item"><Icon name={icon} size={16} />{label}</Link>)}
      </nav>
      <div className="pad"><SaveState scope="admin" /></div>
    </>
  );
}

function Dashboard() {
  const idx = useIndex();
  const admin = useAdmin();
  const meta = useSubject();
  const c = idx.counts();
  const openErrata = idx.errata.filter((e) => e.resolution === 'open').length;
  return (
    <div className="screen">
      <Topbar title={`Админ-панель · ${meta.short}`} sub={`Учебная база ${admin.publishedVersion ?? pack.version}`} backTo="" />
      <AdminNav />
      <div className="pad stack">
        <dl className="stat-grid big">
          <div><dt>На проверке</dt><dd>{c.review}</dd></div>
          <div><dt>Утверждено</dt><dd>{c.approved}</dd></div>
          <div><dt>Отклонено</dt><dd>{c.rejected}</dd></div>
          <div><dt>Вопросов в тестах</dt><dd>{c.questionsApproved}<small>/{idx.questions.length}</small></dd></div>
        </dl>
        <Switch id="preview-review" checked={admin.previewReview} onChange={A.setPreviewReview} label="Предпросмотр непроверенных вопросов" hint="Позволяет вам пройти тесты и «Самопроверку» по вопросам до утверждения. Для студентов не действует." />
        {c.questionsApproved === 0 ? <Notice tone="warn">Ни один вопрос ещё не утверждён — студенты не видят тестов. Начните с <Link to="admin/review">очереди проверки</Link>.</Notice> : null}
        {openErrata ? <Notice tone="info">Открытых замечаний {meta.v.toSrc}: {openErrata}. <Link to="admin/errata">Разобрать</Link></Notice> : null}
        {[...idx.theory, ...idx.formulas, ...idx.examples, ...idx.questions].some((e) => e.student && e.status === 'review') ? <Notice tone="info">Записи с замечаниями переписаны для студентов: исправленный текст без пометок о замечаниях. Проверьте и утвердите их: <Link to="admin/review">Проверка</Link> → «Исправленные тексты». Как было в источнике — под каждой записью.</Notice> : null}
        {idx.staleDecisions().length ? <Notice tone="warn">{idx.staleDecisions().length} {plural(idx.staleDecisions().length, 'запись изменилась', 'записи изменились', 'записей изменились')} в учебной базе после вашей проверки — решение по ним снято, они снова в <Link to="admin/review">очереди проверки</Link>.</Notice> : null}

        {pack.reports.map((r) => (
        <section className="card" key={r.fileId}>
          <h2>Отчёт об импорте: {r.fileName}</h2>
          <table className="kv">
            <tbody>
              <tr><th>Листов PDF / страниц тетради</th><td>{r.pdfPages} / {r.pagesProcessed}</td></tr>
              <tr><th>Нечитаемых страниц</th><td>{r.pagesUnreadable.length}</td></tr>
              <tr><th>Тем</th><td>{r.topics}</td></tr>
              <tr><th>Блоков теории</th><td>{r.theory}</td></tr>
              <tr><th>Формул (ручная проверка)</th><td>{r.formulas} ({r.formulasManualCheck})</td></tr>
              <tr><th>Разобранных примеров</th><td>{r.examples}</td></tr>
              <tr><th>Готовых вопросов в источнике</th><td>{r.questionsInSource}</td></tr>
              <tr><th>Сгенерировано вопросов</th><td>{r.questionsGenerated}</td></tr>
              <tr><th>Записей на проверке при импорте</th><td>{r.recordsForReview}</td></tr>
              <tr><th>Замечаний к источнику</th><td>{r.errata}</td></tr>
            </tbody>
          </table>
          <ul className="small">{r.notes.map((n, i) => <li key={i}>{labelPageRefs(n)}</li>)}</ul>
        </section>
        ))}
      </div>
    </div>
  );
}

type Kind = 'question' | 'theory' | 'formula' | 'example';
const KIND_LABEL: Record<Kind, string> = { question: 'Вопросы', theory: 'Теория', formula: 'Формулы', example: 'Примеры' };

function ReviewQueue() {
  const idx = useIndex();
  const [kind, setKind] = useState<Kind>('question');
  const [status, setStatus] = useState<Status | 'all'>('review');
  const [sub, setSub] = useState('all');
  const [text, setText] = useState('');
  const [onlyStudent, setOnlyStudent] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30);
  const [confirm, setConfirm] = useState<null | Status>(null);
  const all: ContentEntity[] = kind === 'question' ? idx.questions : kind === 'theory' ? idx.theory : kind === 'formula' ? idx.formulas : idx.examples;
  const subTopics = sub === 'all' ? null : new Set(idx.topicsOf(sub).map((t) => t.id));
  const t = text.trim().toLowerCase();
  const list = all
    .filter((e) => (status === 'all' || e.status === status) && (!subTopics || subTopics.has(e.topicId)))
    .filter((e) => !t || JSON.stringify(e).toLowerCase().includes(t))
    .filter((e) => !onlyStudent || !!e.student)
    .sort((a, b) => (idx.topic(a.topicId)?.order ?? 0) - (idx.topic(b.topicId)?.order ?? 0) || a.sourceOrder - b.sourceOrder);
  const shown = list.slice(0, limit);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const apply = (st: Status) => { A.setStatus([...sel], st); toast(`${st === 'approved' ? 'Утверждено' : st === 'rejected' ? 'Отклонено' : 'Возвращено'}: ${sel.size}`); setSel(new Set()); setConfirm(null); };
  const countBy = (k: Kind) => (k === 'question' ? idx.questions : k === 'theory' ? idx.theory : k === 'formula' ? idx.formulas : idx.examples).filter((e) => e.status === 'review').length;

  return (
    <div className="screen">
      <Topbar title="Очередь проверки" sub={`${list.length} ${plural(list.length, 'запись', 'записи', 'записей')}`} backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <Segmented label="Тип записей" value={kind} onChange={(v) => { setKind(v); setSel(new Set()); setLimit(30); }} options={(['question', 'theory', 'formula', 'example'] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k], count: countBy(k) }))} />
        <div className="chips">
          {([['review', 'На проверке'], ['approved', 'Утверждено'], ['rejected', 'Отклонено'], ['all', 'Все']] as [Status | 'all', string][]).map(([v, l]) => <Chip key={v} on={status === v} onClick={() => { setStatus(v); setSel(new Set()); }}>{l}</Chip>)}
          <Chip on={onlyStudent} onClick={() => { setOnlyStudent(!onlyStudent); setSel(new Set()); }}>Исправленные тексты ({all.filter((e) => e.student).length})</Chip>
        </div>
        <div className="filters">
          <label className="field" htmlFor="rq-sub"><span>Подраздел</span>
            <select id="rq-sub" value={sub} onChange={(e) => setSub(e.target.value)}>
              <option value="all">Все подразделы</option>
              {idx.subsections.filter((s) => idx.topicsOf(s.id).length).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="field" htmlFor="rq-text"><span>Поиск</span><input id="rq-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="текст, id, страница" /></label>
        </div>
        <div className="bulk">
          <label className="tree-row"><input type="checkbox" id="rq-all" checked={shown.length > 0 && shown.every((e) => sel.has(e.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((x) => x.id)) : new Set())} /><span>Выбрать показанные ({shown.length})</span></label>
          <Button small icon="check" disabled={!sel.size} onClick={() => setConfirm('approved')} id="bulk-approve">Утвердить ({sel.size})</Button>
          <Button small kind="secondary" icon="x" disabled={!sel.size} onClick={() => setConfirm('rejected')}>Отклонить</Button>
          <Button small kind="ghost" disabled={!sel.size} onClick={() => apply('review')}>На проверку</Button>
        </div>
        {!shown.length ? <Empty icon="check" title="Записей нет">Измените фильтры.</Empty> : null}
        <ul className="review-queue">
          {shown.map((e) => (
            <li key={e.id} className={`rq-item ${e.status}`}>
              <input type="checkbox" aria-label={`Выбрать ${e.id}`} checked={sel.has(e.id)} onChange={() => toggle(e.id)} id={`rq-${e.id}`} />
              <div className="rq-body">
                <div className="rq-meta">
                  <code>{e.id}</code>
                  <Badge tone={e.status === 'approved' ? 'ok' : e.status === 'rejected' ? 'bad' : 'warn'}>{A.statusLabel[e.status]}</Badge>
                  {'type' in e ? <Badge>{TYPE_LABEL[e.type]}</Badge> : null}
                  {'generated' in e && e.generated ? <Badge>сгенерировано</Badge> : null}
                  {e.web ? <WebBadge /> : null}
                  {e.errata?.length ? <Badge tone="bad" title="Что не так и что предлагается — ниже, под записью">замечание {e.errata.join(', ')}</Badge> : null}
                  {e.student ? <Badge tone="ok" title="Студенты видят этот текст — без упоминаний замечаний. Исходная запись — ниже">текст для студентов</Badge> : null}
                  {'manualCheck' in e && e.manualCheck ? <Badge tone="bad" title="Смысл формулы в источнике неясен — сверьте её с фото страницы">сверить с фото</Badge> : null}
                  <span className="muted small">стр. {e.sources.map((s) => pageLabel(s.page)).join(', ')}</span>
                </div>
                <EntityPreview e={e} />
                {e.web ? (
                  <p className="small web-src">
                    <b>Не из материалов — из интернета.</b> Сверьте с источником:{' '}
                    {e.web.map((r, i) => <span key={r.url}>{i ? ', ' : ''}<a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a></span>)}
                  </p>
                ) : null}
                <OriginalRecord e={e} />
                <EntityErrata e={e} />
                <div className="rq-actions">
                  <Button small kind="secondary" icon="edit" onClick={() => navigate(`admin/edit/${e.id}`)}>Открыть</Button>
                  {e.status !== 'approved' ? <Button small icon="check" onClick={() => A.setStatus([e.id], 'approved')}>Утвердить</Button> : null}
                  {e.status !== 'rejected' ? <Button small kind="ghost" icon="x" onClick={() => A.setStatus([e.id], 'rejected')}>Отклонить</Button> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {list.length > limit ? <Button kind="secondary" full onClick={() => setLimit(limit + 30)}>Показать ещё ({list.length - limit})</Button> : null}
      </div>
      <Confirm open={!!confirm} title={confirm === 'approved' ? `Утвердить ${sel.size} зап.?` : `Отклонить ${sel.size} зап.?`} confirmText={confirm === 'approved' ? 'Утвердить' : 'Отклонить'} danger={confirm === 'rejected'} onCancel={() => setConfirm(null)} onConfirm={() => confirm && apply(confirm)}>
        <p>{confirm === 'approved' ? 'Утверждённые вопросы сразу станут доступны студентам в тестах. Убедитесь, что вы проверили их по источнику.' : 'Отклонённые записи не показываются студентам. Решение можно изменить.'}</p>
      </Confirm>
    </div>
  );
}

const resolveErratum = (id: string, r: ErratumResolution) => {
  A.resolveErratum(id, r);
  toast(r === 'accepted' ? `Замечание ${id}: исправление принято` : r === 'kept' ? `Замечание ${id}: оставлено как в источнике` : `Замечание ${id}: решение отменено`);
};

/** Замечания к записи прямо в очереди проверки: к чему, как в конспекте, что не так, что предлагается. */
function EntityErrata({ e, open }: { e: ContentEntity; open?: boolean }) {
  const idx = useIndex();
  const list = (e.errata ?? []).map((id) => idx.erratum(id)).filter((x): x is NonNullable<typeof x> => !!x);
  const manual = 'manualCheck' in e && (e as Formula).manualCheck;
  if (!list.length && !manual) return null;
  return (
    <div className="rq-errata">
      {manual ? <p className="warn-line"><Icon name="alert" size={16} /> Сверьте формулу с фото стр. {e.sources.map((s) => pageLabel(s.page)).join(', ')}: в источнике неясно, к чему она относится{list.length ? ' (подробно — в замечании ниже)' : ''}.</p> : null}
      {list.length ? (
        <details open={open ?? e.status !== 'approved'}>
          <summary>{list.length > 1 ? `Замечания к записи (${list.length})` : 'Замечание к записи'}: к чему, что не так и что предлагаю</summary>
          {list.map((er) => <ErratumCard key={er.id} e={er} admin onResolve={(r) => resolveErratum(er.id, r)} />)}
        </details>
      ) : null}
    </div>
  );
}

/** Для записи с видом для студентов — что изменено: как в конспекте и как видят студенты. */
const FIELD_LABEL: Record<string, string> = {
  title: 'Заголовок', body: 'Текст', tex: 'Формула', given: 'Дано', steps: 'Решение', answer: 'Ответ',
  prompt: 'Вопрос', hints: 'Подсказка', explanation: 'Объяснение', reference: 'Эталонный ответ',
};
function FieldValue({ k, v }: { k: string; v: unknown }) {
  if (v == null || v === '') return <span className="muted">—</span>;
  if (k === 'tex') return <Tex tex={String(v)} display />;
  if (k === 'title') return <b>{String(v)}</b>;
  if (Array.isArray(v)) return <ol>{v.map((x, i) => <li key={i}><Rich text={String(x)} /></li>)}</ol>;
  return <Rich text={String(v)} />;
}
function OriginalRecord({ e }: { e: ContentEntity }) {
  const idx = useIndex();
  if (!e.student) return null;
  const orig = idx.original(e.id) as unknown as Record<string, unknown> | undefined;
  if (!orig) return null;
  const keys = Object.keys(e.student).filter((k) => k !== 'hide');
  return (
    <details className="rq-original">
      <summary>Что изменено для студентов ({keys.map((k) => FIELD_LABEL[k] ?? k).join(', ').toLowerCase()})</summary>
      {keys.map((k) => (
        <div key={k} className="rq-diff">
          <p className="label">{FIELD_LABEL[k] ?? k}</p>
          <div className="rq-diff-old"><span className="small muted">Как в источнике</span><FieldValue k={k} v={orig[k]} /></div>
          <div className="rq-diff-new"><span className="small muted">Видят студенты</span><FieldValue k={k} v={(e.student as Record<string, unknown>)[k]} /></div>
        </div>
      ))}
    </details>
  );
}

function EntityPreview({ e }: { e: ContentEntity }) {
  const idx = useIndex();
  const topic = idx.topic(e.topicId)?.title;
  if ('type' in e) {
    const q = e as Question;
    return (
      <div className="rq-preview">
        <p className="muted small">{topic}</p>
        <Rich text={q.prompt} />
        {q.options ? <ul className="small">{q.options.map((o) => <li key={o.key} className={(Array.isArray(q.answer) ? q.answer.includes(o.key) : q.answer === o.key) ? 'correct-opt' : ''}><Rich inline text={o.body} /></li>)}</ul> : null}
        {q.numeric ? <p className="small"><b>Ответ:</b> {q.numeric.value} {q.numeric.unit} <span className="muted">(проверено: {q.numeric.check})</span></p> : null}
        {q.pairs ? <ul className="small">{q.pairs.map((p, i) => <li key={i}><Rich inline text={p[0]} /> → <Rich inline text={p[1]} /></li>)}</ul> : null}
        {q.sequence ? <ol className="small">{q.sequence.map((s, i) => <li key={i}><Rich inline text={s} /></li>)}</ol> : null}
        {q.reference ? <p className="small"><b>Эталон:</b> <Rich inline text={q.reference} /></p> : null}
      </div>
    );
  }
  if ('tex' in e) return <div className="rq-preview"><p className="muted small">{topic} · <Rich inline text={(e as Formula).title} /></p><Tex tex={(e as Formula).tex} display /></div>;
  if ('body' in e) return <div className="rq-preview"><p className="muted small">{topic}{(e as Theory).title ? <> · <Rich inline text={(e as Theory).title} /></> : ''}</p><Rich text={(e as Theory).body} /></div>;
  const x = e as Example;
  return <div className="rq-preview"><p className="muted small">{topic} · <Rich inline text={x.title} /></p><ol className="small">{x.steps.map((s, i) => <li key={i}><Rich inline text={s} /></li>)}</ol></div>;
}

function texError(tex: string): string | null {
  try {
    katex.renderToString(normalizeLatex(tex), { throwOnError: true, displayMode: true });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
function mdErrors(md: string): string | null {
  const re = /\$([^$]+)\$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const err = texError(m[1]);
    if (err) return `${m[0]}: ${err}`;
  }
  return null;
}

function Editor({ id }: { id: string }) {
  const idx = useIndex();
  const admin = useAdmin();
  const e = idx.entity(id);
  const kind = idx.kindOf(id);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  if (!e || !kind) return <div className="screen"><Topbar title="Запись не найдена" backTo="admin/review" /></div>;
  const val = <T,>(k: string, fallback: T): T => (k in draft ? (draft[k] as T) : fallback);
  const setV = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const patched = !!admin.patches[id];
  const merged = { ...e, ...draft } as ContentEntity;
  let error: string | null = null;
  if (kind === 'formula') error = texError(val('tex', (e as Formula).tex));
  else if (kind === 'theory') error = mdErrors(val('body', (e as Theory).body));
  else if (kind === 'question') error = mdErrors(val('prompt', (e as Question).prompt)) ?? mdErrors(val('explanation', (e as Question).explanation));
  const save = () => {
    const fields: Record<string, unknown> = { ...draft };
    if (typeof fields.tex === 'string') fields.tex = normalizeLatex(fields.tex as string);
    for (const k of ['body', 'prompt', 'explanation', 'title']) if (typeof fields[k] === 'string') fields[k] = normalizeMarkdownMath(fields[k] as string);
    if (fields.hint !== undefined) { fields.hints = [normalizeMarkdownMath(fields.hint as string)]; delete fields.hint; }
    A.patchEntity(id, fields);
    setDraft({});
    toast('Сохранено');
  };
  const q = kind === 'question' ? (merged as Question) : null;

  return (
    <div className="screen">
      <Topbar title="Редактор" sub={`${id} · ${A.statusLabel[e.status]}`} backTo="admin/review" />
      <div className="pad stack editor">
        <div className="row-actions wrap">
          <Button icon="check" onClick={() => { if (Object.keys(draft).length) save(); A.setStatus([id], 'approved'); toast('Утверждено'); }} disabled={!!error}>Сохранить и утвердить</Button>
          <Button kind="secondary" icon="x" onClick={() => A.setStatus([id], 'rejected')}>Отклонить</Button>
          <Button kind="secondary" disabled={!Object.keys(draft).length || !!error} onClick={save}>Сохранить</Button>
          {patched ? <Button kind="ghost" onClick={() => { A.revertEntity(id); setDraft({}); }}>Отменить все правки</Button> : null}
        </div>
        {error ? <Notice tone="bad">Ошибка в формуле: {error}</Notice> : null}
        <OriginalRecord e={e} />
        <EntityErrata e={e} open />

        {kind === 'formula' ? (
          <>
            <label className="field" htmlFor="ed-title"><span>Название</span><input id="ed-title" value={val('title', (e as Formula).title)} onChange={(x) => setV('title', x.target.value)} /></label>
            <label className="field" htmlFor="ed-tex"><span>LaTeX</span><textarea id="ed-tex" rows={3} className="mono" value={val('tex', (e as Formula).tex)} onChange={(x) => setV('tex', x.target.value)} /></label>
            {!error ? <Tex tex={normalizeLatex(val('tex', (e as Formula).tex))} display /> : null}
            <label className="field" htmlFor="ed-cond"><span>Условие применимости (только из источника)</span><input id="ed-cond" value={val('conditions', (e as Formula).conditions ?? '')} onChange={(x) => setV('conditions', x.target.value)} /></label>
            <Switch id="ed-manual" checked={val('manualCheck', (e as Formula).manualCheck)} onChange={(v) => setV('manualCheck', v)} label="Требует ручной проверки" />
          </>
        ) : null}
        {kind === 'theory' ? (
          <>
            <label className="field" htmlFor="ed-title"><span>Заголовок</span><input id="ed-title" value={val('title', (e as Theory).title ?? '')} onChange={(x) => setV('title', x.target.value)} /></label>
            <label className="field" htmlFor="ed-body"><span>Текст (формулы — в $…$, списки — строки с «- »)</span><textarea id="ed-body" rows={8} value={val('body', (e as Theory).body)} onChange={(x) => setV('body', x.target.value)} /></label>
            <div className="preview card"><Rich text={val('body', (e as Theory).body)} /></div>
          </>
        ) : null}
        {kind === 'example' ? (
          <>
            <label className="field" htmlFor="ed-title"><span>Название</span><input id="ed-title" value={val('title', (e as Example).title)} onChange={(x) => setV('title', x.target.value)} /></label>
            <label className="field" htmlFor="ed-steps"><span>Шаги (по одному в строке)</span><textarea id="ed-steps" rows={6} value={val<string[]>('steps', (e as Example).steps).join('\n')} onChange={(x) => setV('steps', x.target.value.split('\n'))} /></label>
          </>
        ) : null}
        {q ? (
          <>
            <label className="field" htmlFor="ed-prompt"><span>Формулировка</span><textarea id="ed-prompt" rows={4} value={val('prompt', (e as Question).prompt)} onChange={(x) => setV('prompt', x.target.value)} /></label>
            {q.options ? (
              <fieldset className="card">
                <legend>Варианты ответа (отметьте верные)</legend>
                {q.options.map((o, i) => {
                  const correct = Array.isArray(q.answer) ? q.answer.includes(o.key) : q.answer === o.key;
                  return (
                    <div key={o.key} className="opt-edit">
                      <input type={q.type === 'single' ? 'radio' : 'checkbox'} name="ed-correct" id={`ed-c-${o.key}`} checked={correct} aria-label={`Вариант ${o.key} верный`}
                        onChange={() => setV('answer', q.type === 'single' ? o.key : correct ? (q.answer as string[]).filter((k) => k !== o.key) : [...(q.answer as string[]), o.key])} />
                      <input id={`ed-o-${o.key}`} value={o.body} onChange={(x) => setV('options', q.options!.map((oo, j) => (j === i ? { ...oo, body: x.target.value } : oo)))} />
                    </div>
                  );
                })}
              </fieldset>
            ) : null}
            {q.numeric ? (
              <div className="filters">
                <label className="field" htmlFor="ed-num"><span>Эталонный ответ</span><input id="ed-num" inputMode="decimal" value={String(q.numeric.value)} onChange={(x) => setV('numeric', { ...q.numeric, value: Number(x.target.value.replace(',', '.')) })} /></label>
                <label className="field" htmlFor="ed-unit"><span>Единица</span><input id="ed-unit" value={q.numeric.unit} onChange={(x) => setV('numeric', { ...q.numeric, unit: x.target.value })} /></label>
                <label className="field" htmlFor="ed-tol"><span>Допуск, %</span><input id="ed-tol" inputMode="decimal" value={String(q.numeric.tol * 100)} onChange={(x) => setV('numeric', { ...q.numeric, tol: Number(x.target.value.replace(',', '.')) / 100 })} /></label>
              </div>
            ) : null}
            <label className="field" htmlFor="ed-hint"><span>Подсказка после первой ошибки (только из источника)</span><textarea id="ed-hint" rows={2} value={val('hint', (e as Question).hints[0] ?? '')} onChange={(x) => setV('hint', x.target.value)} /></label>
            <label className="field" htmlFor="ed-expl"><span>Объяснение</span><textarea id="ed-expl" rows={4} value={val('explanation', (e as Question).explanation)} onChange={(x) => setV('explanation', x.target.value)} /></label>
            <section className="card"><h3>Предпросмотр</h3><Rich text={q.prompt} />{!error ? <Explanation q={{ ...q, hints: [val('hint', q.hints[0] ?? '')] }} /> : null}</section>
          </>
        ) : null}

        <section className="card">
          <h3>Источник — сверка с оригиналом</h3>
          {e.sources.map((s) => {
            const p = idx.page(s.page);
            return p ? (
              <figure key={s.page} className="src-fig">
                <img src={p.image} alt={`Страница ${s.page}`} loading="lazy" />
                <figcaption><Link to={`page/${s.page}`}>Страница {s.page}</Link>{p.date ? ` · ${p.date}` : ''}</figcaption>
              </figure>
            ) : <Notice key={s.page} tone="bad">Страница {s.page} не найдена</Notice>;
          })}
        </section>
      </div>
    </div>
  );
}

function ErrataScreen() {
  const idx = useIndex();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const list = idx.errata.filter((e) => filter === 'all' || e.resolution === 'open');
  const related = (eid: string) => [...idx.theory, ...idx.formulas, ...idx.examples].filter((x) => x.errata?.includes(eid));
  return (
    <div className="screen">
      <Topbar title="Замечания к источнику" sub="Оригинал сохраняется; решение — за вами" backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <Segmented label="Фильтр" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Открытые', count: idx.errata.filter((e) => e.resolution === 'open').length }, { value: 'all', label: 'Все', count: idx.errata.length }]} />
        {!list.length ? <Empty icon="check" title="Открытых замечаний нет" /> : null}
        {list.map((e) => (
          <article key={e.id} className="card errata-card">
            <ErratumCard e={e} admin onResolve={(r) => resolveErratum(e.id, r)}>
              {related(e.id).length ? <p className="small">Записи с этим замечанием: {related(e.id).map((r) => <Link key={r.id} to={`admin/edit/${r.id}`} className="chip">{r.id}</Link>)}</p> : null}
            </ErratumCard>
          </article>
        ))}
      </div>
    </div>
  );
}

function RenameInput({ id, value }: { id: string; value: string }) {
  const [v, setV] = useState(value);
  return (
    <span className="rename">
      <input id={`rn-${id}`} aria-label="Название" value={v} onChange={(e) => setV(e.target.value)} />
      {v.trim() && v !== value ? <Button small onClick={() => { A.renameNode(id, v); toast('Переименовано'); }}>Сохранить</Button> : null}
    </span>
  );
}

function StructureScreen() {
  const idx = useIndex();
  const [newSub, setNewSub] = useState('');
  const [newTopic, setNewTopic] = useState<Record<string, string>>({});
  return (
    <div className="screen">
      <Topbar title="Структура курса" sub="Раздел → подраздел → тема" backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <p className="muted small">Пустые разделы студенту не показываются. Изменение структуры не затрагивает историю результатов: ID тем остаются прежними.</p>
        {idx.sections.map((s) => (
          <section key={s.id} className="card">
            <div className="struct-row strong">
              <RenameInput id={s.id} value={s.title} />
              <Segmented label={`Статус раздела ${s.title}`} value={s.status} onChange={(v) => A.setSectionStatus(s.id, v)} options={[{ value: 'active', label: 'Активен' }, { value: 'planned', label: 'План' }]} />
            </div>
            {idx.subsections.filter((ss) => ss.sectionId === s.id).map((ss, i, arr) => (
              <div key={ss.id} className="struct-sub">
                <div className="struct-row">
                  <RenameInput id={ss.id} value={ss.title} />
                  <span className="struct-tools">
                    <button className="icon-btn" disabled={i === 0} onClick={() => A.reorder('subsection', ss.id, -1)} aria-label="Выше"><Icon name="up" size={16} /></button>
                    <button className="icon-btn" disabled={i === arr.length - 1} onClick={() => A.reorder('subsection', ss.id, 1)} aria-label="Ниже"><Icon name="down" size={16} /></button>
                  </span>
                </div>
                <ol className="struct-topics">
                  {idx.topics.filter((t) => t.subsectionId === ss.id).map((t, j, tarr) => (
                    <li key={t.id} className="struct-row small">
                      <RenameInput id={t.id} value={t.title} />
                      <span className="struct-tools">
                        <select aria-label="Переместить в подраздел" value={t.subsectionId} onChange={(e) => A.moveTopic(t.id, e.target.value)} id={`mv-${t.id}`}>
                          {idx.subsections.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                        </select>
                        <button className="icon-btn" disabled={j === 0} onClick={() => A.reorder('topic', t.id, -1)} aria-label="Выше"><Icon name="up" size={16} /></button>
                        <button className="icon-btn" disabled={j === tarr.length - 1} onClick={() => A.reorder('topic', t.id, 1)} aria-label="Ниже"><Icon name="down" size={16} /></button>
                      </span>
                    </li>
                  ))}
                </ol>
                <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (newTopic[ss.id]?.trim()) { A.addTopic(ss.id, newTopic[ss.id]); setNewTopic({ ...newTopic, [ss.id]: '' }); } }}>
                  <input aria-label="Новая тема" placeholder="Новая тема" id={`nt-${ss.id}`} value={newTopic[ss.id] ?? ''} onChange={(e) => setNewTopic({ ...newTopic, [ss.id]: e.target.value })} />
                  <Button small kind="secondary" icon="plus" type="submit">Тема</Button>
                </form>
              </div>
            ))}
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (newSub.trim()) { A.addSubsection(s.id, newSub); setNewSub(''); } }}>
              <input aria-label="Новый подраздел" placeholder={`Новый подраздел в «${s.title}»`} id={`ns-${s.id}`} value={newSub} onChange={(e) => setNewSub(e.target.value)} />
              <Button small kind="secondary" icon="plus" type="submit">Подраздел</Button>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}

function Duplicates() {
  useAdmin();
  const groups = A.duplicateGroups();
  return (
    <div className="screen">
      <Topbar title="Дубликаты" backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <p className="muted small">Сравнение по нормализованному тексту вопроса (регистр, пробелы, знаки препинания не учитываются). Повторный импорт того же файла дублей не создаёт.</p>
        {!groups.length ? <Empty icon="check" title="Дублей не найдено" /> : groups.map((g, i) => (
          <section key={i} className="card">
            {g.map((q) => (
              <div key={q.id} className="rq-item">
                <div className="rq-body">
                  <div className="rq-meta"><code>{q.id}</code><Badge>{A.statusLabel[q.status]}</Badge></div>
                  <Rich text={q.prompt} />
                  <Button small kind="ghost" icon="x" onClick={() => A.setStatus([q.id], 'rejected')}>Отклонить как дубль</Button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function Sources({ page }: { page?: string }) {
  const idx = useIndex();
  const all = [...idx.theory, ...idx.formulas, ...idx.examples, ...idx.questions];
  const byPage = useMemo(() => {
    const m = new Map<string, ContentEntity[]>();
    for (const e of all) for (const s of e.sources) m.set(s.page, [...(m.get(s.page) ?? []), e]);
    return m;
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const broken = all.filter((e) => e.sources.some((s) => !idx.page(s.page)) || !e.sources.length);
  const p = page ? idx.page(page) : undefined;
  return (
    <div className="screen">
      <Topbar title="Проверка источников" sub={p ? `Страница ${page}` : `${idx.pack.pages.length} страниц`} backTo={p ? 'admin/sources' : 'admin'} />
      <AdminNav />
      <div className="pad stack">
        {broken.length ? <Notice tone="bad">Записей с неверной ссылкой на источник: {broken.length}</Notice> : <Notice tone="ok">У всех {all.length} записей есть ссылка на существующую страницу.</Notice>}
        {p ? (
          <>
            {p.image ? <figure className="src-fig"><img src={p.image} alt={`Страница ${page}`} /></figure> : <Notice tone="info">Изображения страниц книги в приложение не встраиваются (авторское право): сверяйте записи по своему экземпляру — {idx.pack.sourceFiles.find((f) => f.id === p.file)?.title}, с. {pageLabel(p.ref)} (лист PDF {p.pdfPage}).</Notice>}
            <ul className="list">
              {(byPage.get(page!) ?? []).map((e) => (
                <li key={e.id}><Link to={`admin/edit/${e.id}`} className="row"><span className="row-main"><code>{e.id}</code><span className="muted">{A.statusLabel[e.status]}</span></span><Icon name="next" /></Link></li>
              ))}
            </ul>
          </>
        ) : (
          <div className="page-grid">
            {idx.pack.pages.map((pg) => (
              <Link key={pg.ref} to={`admin/sources/${pg.ref}`} className="page-cell">
                <b>{pageLabel(pg.ref)}</b>
                <span>{byPage.get(pg.ref)?.length ?? 0} зап.</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Publish() {
  const idx = useIndex();
  const admin = useAdmin();
  const [out, setOut] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLTextAreaElement>(null);
  const c = idx.counts();
  const client = supabase();
  const showOut = (name: string, text: string) => { setOut(text); tryDownload(name, text); };
  const publishServer = async () => {
    if (!client) return;
    setBusy(true);
    try {
      const version = A.publish();
      const merged = { ...A.buildMergedPack(), version };
      await client.rpc('publish_content_pack', { p_pack: merged });
      setMsg({ ok: true, text: `Версия ${version} опубликована на сервере. Студенты получат её при следующем запуске.` });
    } catch (e) {
      setMsg({ ok: false, text: `Не удалось опубликовать: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Topbar title="Публикация и резервные копии" backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <section className="card">
          <h2>Публикация</h2>
          <p>Утверждено записей: <b>{c.approved}</b>, на проверке: {c.review}, отклонено: {c.rejected}. В тестах доступно вопросов: <b>{c.questionsApproved}</b>.</p>
          <p className="muted small">{admin.publishedAt ? `Последняя публикация: версия ${admin.publishedVersion}, ${fmtDate(admin.publishedAt)}.` : 'Публикаций ещё не было.'}</p>
          {backendEnabled() ? (
            <Button icon="upload" disabled={busy} onClick={publishServer}>Опубликовать на сервере</Button>
          ) : (
            <>
              <p className="small">Сервер не подключён: изменения уже действуют на этом устройстве. Чтобы передать их в сборку приложения, экспортируйте пакет и замените им <code>content/pack.json</code> (инструкция — docs/07-adding-materials.md).</p>
              <Button icon="flag" onClick={() => { const v = A.publish(); setMsg({ ok: true, text: `Зафиксирована версия ${v}.` }); }}>Зафиксировать версию</Button>
            </>
          )}
          {msg ? <Notice tone={msg.ok ? 'ok' : 'bad'}>{msg.text}</Notice> : null}
        </section>
        <section className="card">
          <h2>Экспорт и импорт учебной базы</h2>
          <div className="row-actions wrap">
            <Button kind="secondary" icon="download" onClick={() => showOut(`pack-${admin.publishedVersion ?? pack.version}.json`, JSON.stringify(A.buildMergedPack()))}>Экспорт пакета (JSON)</Button>
            <label className="btn btn-secondary file-btn"><Icon name="upload" size={18} /><span>Импорт пакета</span>
              <input type="file" accept=".json,application/json" id="import-pack" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const r = A.importPack(await f.text()); setMsg({ ok: r.ok, text: r.message }); } e.target.value = ''; }} />
            </label>
          </div>
          <p className="muted small">При импорте новые вопросы получают статус «на проверке», совпадающие по тексту — пропускаются.</p>
        </section>
        <section className="card">
          <h2>Резервная копия правок</h2>
          <div className="row-actions wrap">
            <Button kind="secondary" icon="download" onClick={() => showOut(`admin-backup-${new Date().toISOString().slice(0, 10)}.json`, A.exportBackup())}>Сохранить копию</Button>
            <label className="btn btn-secondary file-btn"><Icon name="upload" size={18} /><span>Восстановить</span>
              <input type="file" accept=".json,application/json" id="restore-backup" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const r = A.restoreBackup(await f.text()); setMsg({ ok: r.ok, text: r.message }); } e.target.value = ''; }} />
            </label>
          </div>
        </section>
        {out ? (
          <section className="card">
            <p className="muted small">Если файл не скачался (в некоторых окнах загрузки запрещены), скопируйте текст.</p>
            <textarea ref={outRef} readOnly rows={5} value={out.length > 200000 ? out.slice(0, 200000) + '…' : out} id="export-out" />
            <Button small kind="secondary" icon="copy" onClick={async () => toast((await copyText(out, outRef.current)) ? 'Скопировано' : 'Текст выделен — скопируйте вручную')}>Скопировать всё</Button>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Upload() {
  const admin = useAdmin();
  const [busy, setBusy] = useState(false);
  return (
    <div className="screen">
      <Topbar title="Загрузка учебных файлов" backTo="admin" />
      <AdminNav />
      <div className="pad stack">
        <label className={`dropzone${busy ? ' busy' : ''}`} htmlFor="upload-input">
          <Icon name="upload" size={28} />
          <b>Выберите файлы</b>
          <span>PDF, DOCX, PPTX, фото страниц (JPEG, PNG, WEBP), до 100 МБ</span>
          <input id="upload-input" type="file" multiple accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png,.webp" onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            setBusy(true);
            for (const f of files) await A.registerUpload(f);
            setBusy(false);
            e.target.value = '';
          }} />
        </label>
        <Notice tone="info">
          В приложении файл проверяется (формат, размер, число страниц, повтор по SHA-256) и регистрируется. Распознавание рукописи и формул выполняется на сервере
          (функция <code>import-file</code>) или инструментом <code>tools/import</code> на компьютере — результат возвращается сюда в очередь проверки.
        </Notice>
        {admin.uploads.length ? (
          <table className="table">
            <thead><tr><th>Файл</th><th>Тип</th><th>Стр.</th><th>Статус</th></tr></thead>
            <tbody>
              {admin.uploads.map((u) => (
                <tr key={u.id}>
                  <td><b>{u.fileName}</b><br /><span className="muted small">{(u.size / 1e6).toFixed(1)} МБ · {u.sha256.slice(0, 12)}</span></td>
                  <td>{u.kind}</td>
                  <td>{u.pages ?? '—'}</td>
                  <td><Badge tone={u.status === 'registered' ? 'ok' : u.status === 'duplicate' ? 'warn' : 'bad'}>{u.status === 'registered' ? 'принят' : u.status === 'duplicate' ? 'повтор' : 'отклонён'}</Badge><br /><span className="small">{u.note}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon="upload" title="Файлы ещё не загружались">Уже импортированы: {pack.sourceFiles.map((f) => `«${f.fileName}»`).join(', ')} — всего {pack.pages.length} стр.</Empty>}
      </div>
    </div>
  );
}

function LogScreen() {
  const admin = useAdmin();
  return (
    <div className="screen">
      <Topbar title="Журнал" sub="Действия администратора и ошибки обработки" backTo="admin" />
      <AdminNav />
      <div className="pad">
        {admin.log.length ? (
          <ul className="log">{admin.log.map((l, i) => <li key={i} className={l.level}><span className="muted small">{fmtDate(l.at)}</span> {l.message}</li>)}</ul>
        ) : <Empty icon="history" title="Журнал пуст" />}
      </div>
    </div>
  );
}
