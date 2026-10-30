// Отображение учебных записей: теория, формулы, примеры, ссылки на источник.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Rich, Tex } from './Rich';
import { Icon } from './Icon';
import { Badge, Button, Link, plural } from './ui';
import { useIndex, useUser, useSubject } from '../../data/store';
import { isBookmarked, toggleBookmark } from '../../data/actions';
import type { Erratum, Example, Formula, SourceRef, Status, Theory, Topic, TopicStage, WebRef } from '../../domain/types';
import { pageLabel } from '../../domain/page-label';

const KIND: Record<Theory['kind'], string> = {
  definition: 'Определение', law: 'Закон', rule: 'Правило', text: 'Теория', list: 'Список', note: 'Пометка', figure: 'Рисунок',
};

/** Ссылка на внешний источник: показывается сайт и название, открывается в новой вкладке. */
function WebLink({ r }: { r: WebRef }) {
  let host = '';
  try {
    host = new URL(r.url).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }
  return (
    <a className="source-chip web-chip" href={r.url} target="_blank" rel="noopener noreferrer" title={`${r.url}${r.checked ? ` · проверено ${r.checked}` : ''}${r.note ? ` · ${r.note}` : ''}`}>
      <Icon name="ext" size={14} />
      <span className="web-title">{r.title}{r.org ? ` — ${r.org}` : ''}</span>
      {host ? <span className="source-date">{host}</span> : null}
    </a>
  );
}

/** Подпись страницы книги: «ч. 1, с. 5». */
function bookPageLabel(idx: ReturnType<typeof useIndex>, ref: string): string {
  const p = idx.page(ref);
  const part = p ? idx.pack.sourceFiles.findIndex((f) => f.id === p.file) + 1 : 0;
  return `${part ? `ч. ${part}, ` : ''}с. ${pageLabel(ref)}`;
}

/** Источники записи по предмету «Математика»: моя книга (место темы) и дополнительные источники. */
function MathSources({ sources, web, generated }: { sources: SourceRef[]; web?: WebRef[]; generated?: boolean }) {
  const idx = useIndex();
  return (
    <span className="sources">
      <span className="sources-label">Моя книга:</span>
      {sources.map((s) => (
        <Link key={s.page} to={`page/${s.page}`} className="source-chip book-chip" ariaLabel={`Место в книге: ${bookPageLabel(idx, s.page)}`}>
          <Icon name="book" size={14} /> {bookPageLabel(idx, s.page)}
        </Link>
      ))}
      {generated ? <span className="muted small">Задание составлено по материалам темы, в книге его нет.</span> : null}
      {web?.length ? (
        <details className="web-sources">
          <summary className="sources-label">Дополнительные источники: {web.length}</summary>
          {web.map((r) => <WebLink key={r.url} r={r} />)}
        </details>
      ) : null}
    </span>
  );
}

export function SourceChips({ sources, web, generated }: { sources: SourceRef[]; web?: WebRef[]; generated?: boolean }) {
  const idx = useIndex();
  const meta = useSubject();
  if (meta.style === 'book') return <MathSources sources={sources} web={web} generated={generated} />;
  return (
    <span className="sources">
      {web?.length ? (
        web.length > 2 ? (
          <details className="web-sources">
            <summary className="sources-label">Из интернета: {web.length} {plural(web.length, 'источник', 'источника', 'источников')}</summary>
            {web.map((r) => <WebLink key={r.url} r={r} />)}
          </details>
        ) : (
          <span className="web-sources">
            <span className="sources-label">Из интернета:</span>
            {web.map((r) => <WebLink key={r.url} r={r} />)}
          </span>
        )
      ) : null}
      <span className="sources-label">{web?.length ? `Место ${meta.v.inSrc}:` : 'Источник:'}</span>
      {sources.map((s) => {
        const p = idx.page(s.page);
        return (
          <Link key={s.page} to={`page/${s.page}`} className="source-chip" ariaLabel={`Открыть страницу ${meta.v.ofSrc} ${s.page}`}>
            <Icon name="page" size={14} />
            стр. {pageLabel(s.page)}
            {p?.date ? <span className="source-date">{p.date.split(' ')[0]}</span> : null}
          </Link>
        );
      })}
    </span>
  );
}

export function WebBadge() {
  const meta = useSubject();
  if (meta.webIsDefault) return null;
  return <Badge tone="accent" title={`Этого нет ${meta.v.inSrc}: материал добавлен из интернета по просьбе владельца, источники — внизу записи`}>из интернета</Badge>;
}

export function StatusBadge({ status, generated, web }: { status: Status; generated?: boolean; web?: boolean }) {
  const meta = useSubject();
  return (
    <>
      {web ? <WebBadge /> : null}
      {status === 'review' ? <Badge tone="warn" title="Запись ещё не проверена администратором">на проверке</Badge> : null}
      {status === 'rejected' ? <Badge tone="bad">отклонено</Badge> : null}
      {generated ? <Badge tone="muted" title={`Вопрос составлен ${meta.style === 'book' ? 'по материалам темы' : meta.v.bySrc}, ${meta.v.inSrc} его нет`}>сгенерировано</Badge> : null}
    </>
  );
}

export const ERRATUM_SEVERITY: Record<Erratum['severity'], [string, 'bad' | 'warn' | 'muted', string]> = {
  error: ['ошибка', 'bad', 'В источнике ошибка: формула или вывод неверны'],
  typo: ['описка', 'warn', 'Описка: пропущен знак, корень, индекс или буква'],
  unclear: ['неясно', 'warn', 'Запись неразборчива или не объяснена — решение зависит от того, что было на занятии'],
  note: ['уточнение', 'muted', 'Запись верна по смыслу, но её стоит уточнить'],
};

export type ErratumResolution = 'open' | 'accepted' | 'kept';

/** Карточка замечания: к чему оно, как в источнике, что не так, что предлагается и что нужно от администратора. */
export function ErratumCard({ e, onResolve, admin = false, children }: { e: Erratum; onResolve?: (r: ErratumResolution) => void; admin?: boolean; children?: ReactNode }) {
  const [label, tone, sevTitle] = ERRATUM_SEVERITY[e.severity];
  const meta = useSubject();
  const res = e.resolution ?? 'open';
  return (
    <section className={`erratum erratum-${e.severity} erratum-res-${res}`} aria-label={`Замечание ${e.id}`}>
      <div className="erratum-head">
        <Icon name="flag" size={16} />
        <b>Замечание {e.id}</b>
        <Badge tone={tone} title={sevTitle}>{label}</Badge>
        <Link to={`page/${e.page}`} className="erratum-page">стр. {pageLabel(e.page)}</Link>
        {res !== 'open' ? <Badge tone="ok">{res === 'accepted' ? 'исправление принято' : `оставлено как ${meta.v.inSrc}`}</Badge> : admin ? <Badge tone="warn">ждёт решения</Badge> : null}
      </div>
      <dl className="erratum-grid">
        {e.target ? (<><dt>К чему</dt><dd><Rich inline text={e.target} /></dd></>) : null}
        <dt>В источнике</dt><dd className="erratum-orig"><Rich inline text={e.original} /></dd>
        <dt>Что не так</dt><dd><Rich inline text={e.issue} /></dd>
        <dt>Предлагаю</dt><dd className="erratum-fix"><Rich inline text={e.suggestion} /></dd>
        {admin && e.todo ? (<><dt>Что нужно от вас</dt><dd className="erratum-todo"><Rich inline text={e.todo} /></dd></>) : null}
      </dl>
      {children}
      {onResolve ? (
        <>
          <div className="row-actions wrap">
            {res !== 'accepted' ? <Button small icon="check" onClick={() => onResolve('accepted')}>Принять исправление</Button> : null}
            {res !== 'kept' ? <Button small kind="secondary" onClick={() => onResolve('kept')}>Оставить как {meta.v.inSrc}</Button> : null}
            {res !== 'open' ? <Button small kind="ghost" onClick={() => onResolve('open')}>Отменить решение</Button> : null}
          </div>
          <p className="muted small">Замечания и решения видны только в админ-панели. Студенты видят текст записи без пометок: по принятому замечанию — исправленный, по оставленному — как в источнике (тексты — в content/subjects/…/student.yaml). Если решение изменится, текст для студентов нужно обновить отдельно.</p>
        </>
      ) : null}
    </section>
  );
}

/** Замечания к записи — только для админ-панели (студенты видят исправленный текст без пометок). */
export function ErrataNote({ ids }: { ids?: string[] }) {
  const idx = useIndex();
  const meta = useSubject();
  const [open, setOpen] = useState(false);
  if (!ids?.length) return null;
  const list = ids.map((id) => idx.erratum(id)).filter((e): e is Erratum => !!e);
  const accepted = list.filter((e) => e.resolution === 'accepted');
  return (
    <div className="errata">
      {accepted.map((e) => (
        <p key={e.id} className="errata-fixed">
          <Icon name="check" size={16} />
          <span><b>Исправление {meta.v.toSrc}:</b> <Rich inline text={e.suggestion} /></span>
        </p>
      ))}
      <button className="errata-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="flag" size={16} />
        {accepted.length === list.length ? 'Почему исправлено' : `Замечание ${meta.v.toSrc}`} ({list.map((e) => e.id).join(', ')})
        <Icon name={open ? 'up' : 'down'} size={16} />
      </button>
      {open
        ? list.map((e) => (
            <ErratumCard key={e.id} e={e}>
              {e.resolution !== 'accepted' ? (
                <p className="muted small">{e.resolution === 'kept' ? `Решение: оставлено как ${meta.v.inSrc}.` : 'Решение по замечанию ещё не принято.'}</p>
              ) : null}
            </ErratumCard>
          ))
        : null}
    </div>
  );
}

/** Встраиваемый SVG допускается, только если в нём нет активного содержимого (повторная проверка на клиенте). */
const UNSAFE_SVG = /<script|\son[a-z]+\s*=|javascript:|<foreignObject|(?:xlink:)?href\s*=\s*["'](?!#)|<image|<iframe|<object|<embed/i;

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Анимированная иллюстрация: SVG с анимацией SMIL, кнопка «Пауза», уважение настройки «уменьшить движение». */
export function AnimFigure({ id, web = false }: { id: string; web?: boolean }) {
  const idx = useIndex();
  const meta = useSubject();
  const fig = idx.pack.figures?.[id];
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  useEffect(() => {
    const svg = ref.current?.querySelector('svg') as (SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void }) | null;
    if (!svg) return;
    try {
      if (playing) svg.unpauseAnimations?.();
      else svg.pauseAnimations?.();
    } catch {
      /* старый движок без SMIL — рисунок остаётся статичным */
    }
  }, [playing, fig]);
  if (!fig || UNSAFE_SVG.test(fig.svg)) return null;
  return (
    <figure className="anim-fig">
      <div className="anim-fig-art" ref={ref} role="img" aria-label={fig.title} dangerouslySetInnerHTML={{ __html: fig.svg }} />
      <figcaption>
        <span>{meta.style === 'book' ? 'Анимация к теме' : web ? 'Анимация к материалу из интернета' : `Анимация по рисунку ${meta.v.ofSrc}`}</span>
        <button type="button" className="anim-fig-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing} aria-label={playing ? 'Остановить анимацию' : 'Запустить анимацию'}>
          <Icon name={playing ? 'pause' : 'play'} size={14} />
          {playing ? 'Пауза' : 'Пуск'}
        </button>
      </figcaption>
    </figure>
  );
}

export function TheoryBlock({ t }: { t: Theory }) {
  return (
    <article className={`theory theory-${t.kind}`}>
      <div className="theory-head">
        <span className="kind">{KIND[t.kind]}</span>
        <StatusBadge status={t.status} web={!!t.web} />
      </div>
      {t.title ? <h3>{t.title}</h3> : null}
      <Rich text={t.body} />
      {t.figure ? <AnimFigure id={t.figure} web={!!t.web} /> : null}
      <SourceChips sources={t.sources} web={t.web} />
    </article>
  );
}

export function Legend({ symbols }: { symbols: string[] }) {
  const idx = useIndex();
  const defs = symbols.map((k) => idx.symbol(k)).filter(Boolean);
  if (!defs.length) return null;
  return (
    <dl className="legend">
      {defs.map((d) => (
        <div key={d!.key} className="legend-row">
          <dt><Tex tex={d!.tex} /></dt>
          <dd>
            <Rich inline text={d!.meaning} />
            {d!.unit ? <span className="unit">[{d!.unit}]</span> : null}
            {d!.src === null ? <Badge tone="warn" title="Обозначение не расшифровано в источнике">не расшифровано</Badge> : null}
            {d!.web ? <Badge tone="accent" title="Расшифровка взята из интернета">из интернета</Badge> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FormulaCard({ f, compact = false }: { f: Formula; compact?: boolean }) {
  const user = useUser();
  const starred = isBookmarked(user, 'formula', f.id);
  const [showLegend, setShowLegend] = useState(!compact);
  return (
    <article className={`formula${f.boxed ? ' boxed' : ''}`} id={f.id}>
      <div className="formula-head">
        <h3>{f.title}</h3>
        <div className="formula-tools">
          <StatusBadge status={f.status} web={!!f.web} />
          {f.boxed ? <Badge tone="accent" title="В источнике формула обведена рамкой">в рамке</Badge> : null}
          <button className={`icon-btn star${starred ? ' on' : ''}`} onClick={() => toggleBookmark('formula', f.id)} aria-pressed={starred} aria-label={starred ? 'Убрать из избранного' : 'В избранное'}>
            <Icon name="star" filled={starred} size={18} />
          </button>
        </div>
      </div>
      <Tex tex={f.tex} display className="formula-tex" />
      {f.manualCheck ? <p className="warn-line"><Icon name="alert" size={16} /> Формула требует ручной проверки: контекст в источнике неясен.</p> : null}
      {f.meaning ? <p className="cond"><span>Обозначения:</span> <Rich inline text={f.meaning} /></p> : null}
      {f.conditions ? <p className="cond"><span>Условие:</span> <Rich inline text={f.conditions} /></p> : null}
      {f.use ? <p className="cond"><span>Когда применять:</span> <Rich inline text={f.use} /></p> : null}
      {f.variants ? <p className="cond"><span>Преобразования:</span> <Rich inline text={f.variants} /></p> : null}
      {f.limits ? <p className="cond"><span>Ограничения:</span> <Rich inline text={f.limits} /></p> : null}
      {f.symbols.length ? (
        compact ? (
          <button className="link-btn" onClick={() => setShowLegend(!showLegend)} aria-expanded={showLegend}>
            {showLegend ? 'Скрыть обозначения' : 'Обозначения и единицы'}
          </button>
        ) : null
      ) : null}
      {showLegend ? <Legend symbols={f.symbols} /> : null}
      <SourceChips sources={f.sources} web={f.web} />
    </article>
  );
}

export function ExampleBlock({ e }: { e: Example }) {
  return (
    <article className="example">
      <div className="theory-head">
        <span className="kind">{e.web ? 'Разобранный пример' : 'Пример из источника'}</span>
        <StatusBadge status={e.status} web={!!e.web} />
      </div>
      <h3>{e.title}</h3>
      {e.given ? <p className="given"><b>{e.find ? 'Условие и данные:' : 'Дано:'}</b> <Rich inline text={e.given} /></p> : null}
      {e.find ? <p className="given"><b>Найти:</b> <Rich inline text={e.find} /></p> : null}
      {e.method ? <p className="given"><b>Метод:</b> <Rich inline text={e.method} /></p> : null}
      <ol className="steps">
        {e.steps.map((s, i) => (
          <li key={i}><Rich inline text={s} /></li>
        ))}
      </ol>
      {e.check ? <p className="given"><b>Проверка:</b> <Rich inline text={e.check} /></p> : null}
      {e.answer ? (
        <p className={`answer-line${e.computed ? ' computed' : ''}`}>
          <b>{e.computed ? 'Вычислено:' : 'Ответ:'}</b> <Rich inline text={e.answer} />
        </p>
      ) : null}
      <SourceChips sources={e.sources} web={e.web} />
    </article>
  );
}

const STAGE: Record<TopicStage, [string, 'muted' | 'accent' | 'warn' | 'ok']> = {
  extracted: ['извлечено', 'muted'],
  prepared: ['подготовлено', 'accent'],
  'needs-check': ['требует проверки', 'warn'],
  verified: ['проверено', 'ok'],
};
/** Этап подготовки темы (предмет-учебник, style: book): извлечено → подготовлено → требует проверки → проверено. */
export function StageBadge({ stage }: { stage: TopicStage }) {
  const [label, tone] = STAGE[stage];
  return <Badge tone={tone} title="Этап подготовки темы; «утверждено» ставит администратор по каждой записи">{label}</Badge>;
}

/** Место темы в книге и состояние её подготовки. */
export function BookPlace({ topic }: { topic: Topic }) {
  if (!topic.book) return null;
  return (
    <div className="pad">
      <details className="book-place">
        <summary><Icon name="book" size={16} /> Моя книга: {topic.book.place}{topic.pages.length ? `, с. ${topic.pages.map(pageLabel).join(', ')}` : ''}</summary>
        {topic.book.summary ? <p className="small">{topic.book.summary}</p> : null}
        <p className="small muted">
          Теория, формулы и примеры составлены по открытым источникам (ссылки — под каждой записью). Задания книги в приложение не перенесены: решайте их по своему экземпляру.
          {topic.sourcesChecked ? ` Источники проверены ${topic.sourcesChecked}.` : ''}
        </p>
        {topic.stage ? <p className="small">Этап: <StageBadge stage={topic.stage} />{topic.stageNote ? ` ${topic.stageNote}` : ''}</p> : null}
      </details>
    </div>
  );
}
