// Главная, учебник (разделы → подразделы → темы), тема в режиме «Обучение», страница источника.

import { useEffect, useState } from 'react';
import { useIndex, useUser, useAdmin, useSettings, useSubject, pack } from '../../data/store';
import { ADMIN_ENABLED } from '../../data/build-flags';
import { openTopic, setStudied, isBookmarked, toggleBookmark } from '../../data/actions';
import { overview } from '../../domain/progress';
import { Topbar, Link, Button, Progress, Empty, Notice, Segmented, plural } from '../components/ui';
import { Icon } from '../components/Icon';
import { TheoryBlock, FormulaCard, ExampleBlock, WebBadge, StageBadge, BookPlace } from '../components/content';
import { QAItem } from '../components/question';
import { navigate } from '../router';
import { pageLabel, labelPageRefs } from '../../domain/page-label';

export { pageLabel };

export function Home() {
  const meta = useSubject();
  const idx = useIndex();
  const user = useUser();
  const admin = useAdmin();
  const ov = overview(user, idx);
  const topics = idx.allVisibleTopics();
  const last = (user.lastTopicId && idx.topic(user.lastTopicId)) || topics[0];
  const lastPath = last ? idx.path(last.id) : null;
  const counts = idx.counts();
  const mistakes = Object.keys(user.errorQueue).length;

  return (
    <div className="screen home">
      <header className="hero">
        <a className="subject-switch" href="#/"><Icon name="apps" size={14} /> Предметы</a>
        <p className="eyebrow">{meta.style === 'book'
          ? `книга: ${pack.sourceFiles.length} ${plural(pack.sourceFiles.length, ...meta.v.file)} · ${pack.pages.length} стр. · ${idx.activeSections().length} ${plural(idx.activeSections().length, 'раздел', 'раздела', 'разделов')}`
          : `${pack.sourceFiles.length} ${plural(pack.sourceFiles.length, ...meta.v.file)} · ${pack.pages.length} ${plural(pack.pages.length, 'страница', 'страницы', 'страниц')} · ${idx.activeSections().length} ${plural(idx.activeSections().length, 'раздел', 'раздела', 'разделов')}`}</p>
        <h1>{meta.title}</h1>
        <div className="hero-stats">
          <div>
            <b>{ov.topicsStudied}</b>
            <span>из {ov.topicsTotal} тем изучено</span>
          </div>
          <div>
            <b>{ov.percentCorrect === null ? '—' : `${ov.percentCorrect}%`}</b>
            <span>верных ответов</span>
          </div>
          <div>
            <b>{ov.testsCompleted}</b>
            <span>{plural(ov.testsCompleted, 'тест пройден', 'теста пройдено', 'тестов пройдено')}</span>
          </div>
        </div>
        <Progress value={ov.percentStudied} label="Изучено тем" tone="accent" />
      </header>

      {last && lastPath ? (
        <Link to={`topic/${last.id}`} className="continue">
          <span className="continue-label">{user.lastTopicId ? 'Продолжить обучение' : 'Начать обучение'}</span>
          <span className="continue-title">{last.title}</span>
          <span className="continue-path">{lastPath.section?.title} · {lastPath.subsection?.title}</span>
          <Icon name="next" />
        </Link>
      ) : null}

      {ov.topicsTotal === 0 && counts.questionsReview === 0 ? (
        <Notice tone="info">Курс готовится: материалы по предмету ещё не добавлены. Темы, теория и тесты появятся здесь после загрузки и проверки материалов.</Notice>
      ) : counts.questionsApproved === 0 ? (
        <Notice tone="warn">
          {counts.questionsReview} {plural(counts.questionsReview, 'вопрос ждёт', 'вопроса ждут', 'вопросов ждут')} проверки. Тесты появятся после
          утверждения вопросов{ADMIN_ENABLED ? <> в <Link to="admin">админ-панели</Link>{admin.previewReview ? '; сейчас включён предпросмотр для администратора.' : '.'}</> : '.'}
        </Notice>
      ) : null}

      <nav className="tiles" aria-label="Разделы приложения">
        <Link to="library" className="tile"><Icon name="book" size={24} /><b>{meta.v.allSections}</b><span>{ov.topicsTotal} {plural(ov.topicsTotal, 'тема', 'темы', 'тем')}</span></Link>
        <Link to="test" className="tile"><Icon name="test" size={24} /><b>Тестирование</b><span>{counts.questionsApproved} {plural(counts.questionsApproved, 'вопрос', 'вопроса', 'вопросов')} в тестах</span></Link>
        <Link to="mistakes" className="tile"><Icon name="refresh" size={24} /><b>Повторение ошибок</b><span>{mistakes ? `${mistakes} в очереди` : 'ошибок пока нет'}</span></Link>
        <Link to="favorites" className="tile"><Icon name="star" size={24} /><b>Избранное</b><span>{user.bookmarks.length} сохранено</span></Link>
        <Link to="progress" className="tile"><Icon name="chart" size={24} /><b>Мой прогресс</b><span>{ov.percentStudied}% курса</span></Link>
        <Link to="modes" className="tile"><Icon name="cards" size={24} /><b>Режимы</b><span>карточки, экзамен, задачи</span></Link>
        <Link to="settings" className="tile"><Icon name="gear" size={24} /><b>Настройки</b><span>тема, данные, аккаунт</span></Link>
        <Link to="search" className="tile"><Icon name="search" size={24} /><b>Поиск</b><span>темы, формулы, вопросы</span></Link>
      </nav>
    </div>
  );
}

export function Library() {
  const idx = useIndex();
  const user = useUser();
  const ov = overview(user, idx);
  const planned = idx.sections.filter((s) => s.status === 'planned');
  return (
    <div className="screen">
      <Topbar title="Все разделы" sub="Раздел → подраздел → тема" backTo="" />
      {ov.sections.map((s) => (
        <section key={s.id} className="block">
          <div className="block-head">
            <h2>{s.title}</h2>
            <span className="muted">{s.studied}/{s.topics} тем</span>
          </div>
          <div className="list">
            {s.subsections.map((ss) => (
              <Link key={ss.id} to={`sub/${ss.id}`} className="row">
                <span className="row-main">
                  <b>{ss.title}</b>
                  <span className="muted">{ss.topics} {plural(ss.topics, 'тема', 'темы', 'тем')} · изучено {ss.studied}{ss.accuracy.percent !== null ? ` · верных ${ss.accuracy.percent}%` : ''}</span>
                  <Progress value={ss.percent} label={`Изучено: ${ss.title}`} />
                </span>
                <Icon name="next" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      {planned.length ? (
        <p className="muted small pad">
          Разделы «{planned.map((p) => p.title).join('», «')}» появятся после загрузки материалов по ним.
        </p>
      ) : null}
      {idx.pack.plan ? <BookPlan /> : null}
    </div>
  );
}

/** Весь курс по оглавлению книги (предмет-учебник, style: book): сколько пунктов каждой главы уже наполнено. */
function BookPlan() {
  const idx = useIndex();
  const plan = idx.pack.plan ?? [];
  const total = idx.topics.length + plan.length;
  return (
    <section className="block">
      <div className="block-head">
        <h2>План курса по книге</h2>
        <span className="muted">наполнено {idx.topics.length} из {total}</span>
      </div>
      <p className="muted small">Порядок — как в оглавлении книги. Пункты, которые ещё готовятся, видны внутри глав.</p>
      {idx.sections.map((s) => (
        <div key={s.id} className="list">
          <p className="label">{s.title}</p>
          {idx.subsections.filter((ss) => ss.sectionId === s.id).map((ss) => {
            const done = idx.topicsOf(ss.id).length;
            const all = done + plan.filter((p) => p.subsectionId === ss.id).length;
            return (
              <Link key={ss.id} to={`sub/${ss.id}`} className="row">
                <span className="row-main">
                  <b>{ss.title}</b>
                  <span className="muted">{done ? `наполнено ${done} из ${all}` : `${all} ${plural(all, 'пункт', 'пункта', 'пунктов')} · готовится`}</span>
                  <Progress value={all ? Math.round((done / all) * 100) : 0} label={`Наполнено: ${ss.title}`} />
                </span>
                <Icon name="next" />
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}

export function SubsectionScreen({ id }: { id: string }) {
  const idx = useIndex();
  const user = useUser();
  const { showReviewContent: showReview } = useSettings();
  const sub = idx.subsection(id);
  if (!sub) return <NotFound />;
  const topics = idx.topicsOf(id);
  const plan = (idx.pack.plan ?? []).filter((p) => p.subsectionId === id);
  return (
    <div className="screen">
      <Topbar title={sub.title} sub={idx.section(sub.sectionId)?.title} backTo="library" actions={<Link to={`test/sub/${id}`} className="icon-btn" ariaLabel="Тест по подразделу"><Icon name="test" /></Link>} />
      {sub.note ? <p className="muted small pad">{labelPageRefs(sub.note)}</p> : null}
      <ol className="list topics">
        {topics.map((t, i) => {
          const studied = !!user.topicProgress[t.id]?.studiedAt;
          const nq = idx.questionsOf(t.id, false).length;
          const nf = idx.formulasOf(t.id, showReview).length;
          return (
            <li key={t.id}>
              <Link to={`topic/${t.id}`} className="row">
                <span className={`topic-n${studied ? ' done' : ''}`} aria-label={studied ? 'Изучено' : undefined}>{studied ? <Icon name="check" size={16} /> : i + 1}</span>
                <span className="row-main">
                  <b>{t.num ? `${t.num} ` : ''}{t.title}{t.web ? <> <WebBadge /></> : null}{t.stage ? <> <StageBadge stage={t.stage} /></> : null}</b>
                  <span className="muted">стр. {t.pages.map(pageLabel).join(', ')} · {nf} {plural(nf, 'формула', 'формулы', 'формул')} · {nq} {plural(nq, 'вопрос', 'вопроса', 'вопросов')}</span>
                </span>
                <Icon name="next" />
              </Link>
            </li>
          );
        })}
      </ol>
      {plan.length ? (
        <div className="pad stack">
          <p className="label">Ещё не наполнено (пункты оглавления книги, по порядку)</p>
          <div className="plan-list">
            {plan.map((p) => (
              <div key={p.id} className="plan-item">
                <b>{p.num}</b><span>{p.title}{p.pages.length ? ` · с. ${pageLabel(p.pages[0])}${p.pages.length > 1 ? `–${pageLabel(p.pages[p.pages.length - 1])}` : ''}` : ''}{p.note ? <><br /><span className="small">{p.note}</span></> : null}</span><StageBadge stage={p.stage} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {topics.length ? (
        <div className="pad">
          <Button full icon="test" onClick={() => navigate(`test/sub/${id}`)}>Тест по подразделу «{sub.title}»</Button>
        </div>
      ) : null}
    </div>
  );
}

type Tab = 'theory' | 'formulas' | 'examples' | 'check';

export function TopicScreen({ id, tab }: { id: string; tab?: string }) {
  const meta = useSubject();
  const settings = useSettings();
  const idx = useIndex();
  const user = useUser();
  const admin = useAdmin();
  const topic = idx.topic(id);
  const [active, setActive] = useState<Tab>((['theory', 'formulas', 'examples', 'check'].includes(tab ?? '') ? tab : 'theory') as Tab);
  useEffect(() => {
    if (topic) openTopic(id);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab && ['theory', 'formulas', 'examples', 'check'].includes(tab)) setActive(tab as Tab);
  }, [tab]);
  if (!topic) return <NotFound />;
  const showReview = settings.showReviewContent;
  const theory = idx.theoryOf(id, showReview);
  const formulas = idx.formulasOf(id, showReview);
  const examples = idx.examplesOf(id, showReview);
  const questions = idx.questionsOf(id, admin.previewReview);
  const studied = !!user.topicProgress[id]?.studiedAt;
  const starred = isBookmarked(user, 'topic', id);
  const { prev, next } = idx.neighbours(id);
  const path = idx.path(id);
  const hiddenCount = idx.theory.filter((x) => x.topicId === id).length + idx.formulas.filter((x) => x.topicId === id).length - theory.length - formulas.length;

  return (
    <div className="screen">
      <Topbar
        title={topic.title}
        sub={`${path.subsection?.title} · стр. ${topic.pages.map(pageLabel).join(', ')}`}
        backTo={`sub/${topic.subsectionId}`}
        actions={
          <button className={`icon-btn star${starred ? ' on' : ''}`} onClick={() => toggleBookmark('topic', id)} aria-pressed={starred} aria-label={starred ? 'Убрать тему из избранного' : 'Сохранить тему в избранное'}>
            <Icon name="star" filled={starred} />
          </button>
        }
      />
      <div className="sticky-tabs">
        <Segmented<Tab>
          label="Разделы темы"
          value={active}
          onChange={(v) => { setActive(v); window.scrollTo({ top: 0 }); }}
          options={[
            { value: 'theory', label: 'Теория', count: theory.length },
            { value: 'formulas', label: 'Формулы', count: formulas.length },
            { value: 'examples', label: 'Примеры', count: examples.length },
            { value: 'check', label: 'Самопроверка', count: questions.length },
          ]}
        />
      </div>

      {hiddenCount > 0 && !showReview ? (
        <Notice tone="info">Скрыто записей на проверке: {hiddenCount}. Их можно показать в настройках.</Notice>
      ) : null}
      {topic.web && !meta.webIsDefault ? (
        <Notice tone="info">Этой темы {meta.v.inSrc} нет (там только заголовок или пробел). Она дополнена из интернета по просьбе владельца — источники указаны под каждой записью.</Notice>
      ) : null}
      {topic.book ? <BookPlace topic={topic} /> : null}

      <div className="stack">
        {active === 'theory' ? (theory.length ? theory.map((t) => <TheoryBlock key={t.id} t={t} />) : <Empty title="Теории в этой теме нет" />) : null}
        {active === 'formulas' ? (formulas.length ? formulas.map((f) => <FormulaCard key={f.id} f={f} />) : <Empty title="Формул в этой теме нет" />) : null}
        {active === 'examples' ? (examples.length ? examples.map((e) => <ExampleBlock key={e.id} e={e} />) : <Empty title={`Разобранных примеров ${meta.v.inSrc} нет`}>Задачи по теме — во вкладке «Самопроверка» и в тестах.</Empty>) : null}
        {active === 'check' ? (
          questions.length ? (
            <>
              <p className="muted small">Режим «вопрос — ответ»: подумайте, затем откройте ответ и объяснение.</p>
              {questions.map((q, i) => <QAItem key={q.id} q={q} n={i + 1} />)}
            </>
          ) : (
            <Empty icon="lock" title="Вопросы ещё не утверждены">
              Вопросы по теме составлены {meta.style === 'book' ? 'по материалам темы' : meta.v.bySrc} и ждут проверки{ADMIN_ENABLED ? <> в <Link to="admin/review">админ-панели</Link></> : null}.
            </Empty>
          )
        ) : null}
      </div>

      <div className="topic-footer">
        <Button kind={studied ? 'secondary' : 'primary'} icon="check" full onClick={() => setStudied(id, !studied)}>
          {studied ? 'Изучено — снять отметку' : 'Отметить тему как изученную'}
        </Button>
        <Button kind="secondary" icon="test" full onClick={() => navigate(`test/topic/${id}`)}>Тест по теме</Button>
        <div className="prevnext">
          {prev ? <Link to={`topic/${prev.id}`} className="pn"><Icon name="back" size={16} /><span>{prev.title}</span></Link> : <span />}
          {next ? <Link to={`topic/${next.id}`} className="pn next"><span>{next.title}</span><Icon name="next" size={16} /></Link> : <span />}
        </div>
      </div>
    </div>
  );
}

export function PageViewer({ refId }: { refId: string }) {
  const idx = useIndex();
  const page = idx.page(refId);
  const meta = useSubject();
  const [zoom, setZoom] = useState(1);
  const [noPhoto, setNoPhoto] = useState(false);
  if (!page) return <NotFound />;
  const i = page.index;
  const prev = idx.pack.pages[i - 1];
  const next = idx.pack.pages[i + 1];
  const topics = idx.topics.filter((t) => t.pages.includes(refId));
  return (
    <div className="screen">
      <Topbar
        title={`Страница ${pageLabel(refId)}`}
        sub={`${idx.pack.sourceFiles.find((f) => f.id === page.file)?.[page.image ? 'fileName' : 'title'] ?? ''} · лист PDF ${page.pdfPage}${page.side ? page.side === 'L' ? ', левая' : ', правая' : ''}${page.date ? ` · ${page.date}` : ''}`}
        backTo=""
        actions={page.image ? (
          <>
            <button className="icon-btn" onClick={() => setZoom(Math.max(1, zoom - 0.5))} aria-label="Уменьшить" disabled={zoom <= 1}>−</button>
            <button className="icon-btn" onClick={() => setZoom(Math.min(3, zoom + 0.5))} aria-label="Увеличить" disabled={zoom >= 3}>+</button>
          </>
        ) : undefined}
      />
      {page.image && noPhoto ? (
        <div className="pad">
          <Notice tone="info">Фото страницы {pageLabel(refId)} в этой сборке нет: изображения страниц {meta.v.ofSrc} не публикуются вместе с исходным кодом.</Notice>
        </div>
      ) : page.image ? (
        <div className="page-frame">
          <img key={page.image} src={page.image} alt={`Фото страницы ${meta.v.ofSrc} ${refId}`} style={{ width: `${zoom * 100}%`, maxWidth: zoom > 1 ? 'none' : '100%' }} loading="lazy" onError={() => setNoPhoto(true)} />
        </div>
      ) : (
        <div className="pad">
          <Notice tone="info">
            Страница {pageLabel(refId)} книги «{idx.pack.sourceFiles.find((f) => f.id === page.file)?.title ?? ''}» (лист PDF {page.pdfPage}).
            Изображения страниц книги в приложение не встраиваются — книга защищена авторским правом; откройте свой экземпляр.
          </Notice>
        </div>
      )}
      <div className="pad stack">
        {topics.length ? (
          <div>
            <p className="label">Темы на этой странице</p>
            <div className="chips">{topics.map((t) => <Link key={t.id} to={`topic/${t.id}`} className="chip">{t.title}</Link>)}</div>
          </div>
        ) : null}
        <div className="prevnext">
          {prev ? <Link to={`page/${prev.ref}`} className="pn"><Icon name="back" size={16} /><span>стр. {pageLabel(prev.ref)}</span></Link> : <span />}
          {next ? <Link to={`page/${next.ref}`} className="pn next"><span>стр. {pageLabel(next.ref)}</span><Icon name="next" size={16} /></Link> : <span />}
        </div>
      </div>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="screen">
      <Topbar title="Не найдено" backTo="" />
      <Empty title="Такой страницы нет">
        <Link to="">На главную</Link>
      </Empty>
    </div>
  );
}
