// Дополнительные режимы: карточки, вопрос–ответ, повторение ошибок, избранное.

import { useMemo, useState } from 'react';
import { useIndex, useUser, useAdmin, useSettings } from '../../data/store';
import { markCard, toggleBookmark } from '../../data/actions';
import { mulberry32, shuffle, newSeed } from '../../domain/random';
import { ContentIndex } from '../../domain/content-index';
import type { Formula, Question } from '../../domain/types';
import { Topbar, Link, Button, Empty, Segmented, Chip, Badge, plural } from '../components/ui';
import { Icon } from '../components/Icon';
import { Tex, Rich } from '../components/Rich';
import { FormulaCard, Legend } from '../components/content';
import { CorrectAnswer, TYPE_LABEL } from '../components/question';
import { navigate } from '../router';

export function Modes() {
  const idx = useIndex();
  const user = useUser();
  const admin = useAdmin();
  const approved = idx.questions.filter((q) => ContentIndex.usableQuestion(q, admin.previewReview));
  const studied = Object.values(user.topicProgress).filter((p) => p.studiedAt).length;
  const items = [
    { to: 'qa', icon: 'eye', title: 'Вопрос — ответ', text: 'Подумайте над вопросом и откройте объяснение.', meta: `${approved.length} вопросов`, off: !approved.length },
    { to: 'cards', icon: 'cards', title: 'Карточки', text: 'Формула или вопрос на одной стороне, ответ — на другой.', meta: `${idx.formulas.length} формул`, off: false },
    { to: 'mistakes', icon: 'refresh', title: 'Повторение ошибок', text: 'Вопросы, на которые вы ответили неверно.', meta: `${Object.keys(user.errorQueue).length} в очереди`, off: false },
    { to: 'favorites', icon: 'star', title: 'Избранное', text: 'Сохранённые вопросы, формулы и темы.', meta: `${user.bookmarks.length} сохранено`, off: false },
    { to: 'test/exam', icon: 'clock', title: 'Экзамен', text: 'Заданное число вопросов, лимит времени, без подсказок.', meta: '20 вопросов · 30 мин', off: !approved.length },
    { to: 'test/formulas', icon: 'formula', title: 'Тренировка формул', text: 'Выбор формулы, обозначения, применение законов.', meta: `${approved.filter((q) => q.category === 'formula').length} вопросов`, off: !approved.some((q) => q.category === 'formula') },
    { to: 'test/problems', icon: 'calc', title: 'Практика задач', text: 'Расчётные задачи с пошаговым решением.', meta: `${approved.filter((q) => q.category === 'problem').length} задач`, off: !approved.some((q) => q.category === 'problem') },
    { to: 'test/review', icon: 'history', title: 'Повторение пройденного', text: 'Тест по темам, отмеченным как изученные.', meta: `${studied} ${plural(studied, 'тема', 'темы', 'тем')}`, off: !studied || !approved.length },
  ];
  return (
    <div className="screen">
      <Topbar title="Режимы" backTo="" />
      <div className="mode-list pad">
        {items.map((m) =>
          m.off ? (
            <div key={m.to} className="mode off" aria-disabled="true">
              <Icon name={m.icon} size={22} />
              <span><b>{m.title}</b><span>{m.text}</span><small>{m.to === 'test/review' && !studied ? 'Сначала отметьте темы как изученные' : 'Нет утверждённых вопросов'}</small></span>
            </div>
          ) : (
            <Link key={m.to} to={m.to} className="mode">
              <Icon name={m.icon} size={22} />
              <span><b>{m.title}</b><span>{m.text}</span><small>{m.meta}</small></span>
              <Icon name="next" />
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

export function QAPicker() {
  const idx = useIndex();
  const admin = useAdmin();
  return (
    <div className="screen">
      <Topbar title="Вопрос — ответ" sub="Выберите тему" backTo="modes" />
      <div className="list pad">
        {idx.allVisibleTopics().map((t) => {
          const n = idx.questionsOf(t.id, admin.previewReview).length;
          return n ? (
            <Link key={t.id} to={`topic/${t.id}/check`} className="row">
              <span className="row-main"><b>{t.title}</b><span className="muted">{n} {plural(n, 'вопрос', 'вопроса', 'вопросов')}</span></span>
              <Icon name="next" />
            </Link>
          ) : null;
        })}
      </div>
    </div>
  );
}

type CardItem = { id: string; kind: 'formula'; f: Formula } | { id: string; kind: 'question'; q: Question };

export function Flashcards() {
  const idx = useIndex();
  const user = useUser();
  const settings = useSettings();
  const admin = useAdmin();
  const [source, setSource] = useState<'formula' | 'question'>('formula');
  const [sub, setSub] = useState<string>('all');
  const [onlyLearn, setOnlyLearn] = useState(false);
  const [seed, setSeed] = useState(() => newSeed());
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const deck: CardItem[] = useMemo(() => {
    const topics = new Set((sub === 'all' ? idx.allVisibleTopics() : idx.topicsOf(sub)).map((t) => t.id));
    const list: CardItem[] =
      source === 'formula'
        ? idx.formulas.filter((f) => topics.has(f.topicId) && ContentIndex.visible(f.status, settings.showReviewContent)).map((f) => ({ id: f.id, kind: 'formula' as const, f }))
        : idx.questions.filter((q) => topics.has(q.topicId) && ContentIndex.usableQuestion(q, admin.previewReview) && q.type !== 'matching' && q.type !== 'sequence').map((q) => ({ id: q.id, kind: 'question' as const, q }));
    return shuffle(list.filter((c) => !onlyLearn || user.cardMarks[c.id] !== 'know'), mulberry32(seed));
  }, [source, sub, onlyLearn, seed, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = deck[Math.min(i, deck.length - 1)];
  const go = (d: number) => { setFlipped(false); setI((x) => Math.max(0, Math.min(deck.length - 1, x + d))); };
  const mark = (m: 'know' | 'learn') => { if (card) markCard(card.id, m); go(1); };
  const known = deck.filter((c) => user.cardMarks[c.id] === 'know').length;

  return (
    <div className="screen">
      <Topbar title="Карточки" sub={deck.length ? `${Math.min(i + 1, deck.length)} из ${deck.length} · знаю ${known}` : undefined} backTo="modes" />
      <div className="pad stack">
        <Segmented label="Источник карточек" value={source} onChange={(v) => { setSource(v); setI(0); setFlipped(false); }} options={[{ value: 'formula', label: 'Формулы' }, { value: 'question', label: 'Вопросы' }]} />
        <div className="chips">
          <Chip on={sub === 'all'} onClick={() => { setSub('all'); setI(0); }}>Весь курс</Chip>
          {idx.subsections.filter((s) => idx.topicsOf(s.id).length).map((s) => <Chip key={s.id} on={sub === s.id} onClick={() => { setSub(s.id); setI(0); }}>{s.title}</Chip>)}
        </div>
        <div className="chips">
          <Chip on={onlyLearn} onClick={() => { setOnlyLearn(!onlyLearn); setI(0); }}>Только «повторить»</Chip>
          <Chip on={false} onClick={() => { setSeed(newSeed()); setI(0); setFlipped(false); }}>Перемешать</Chip>
        </div>
        {!card ? (
          <Empty icon="cards" title="Карточек нет">{source === 'question' ? 'Вопросы появятся после утверждения в админ-панели.' : 'Измените фильтр.'}</Empty>
        ) : (
          <>
            <button className={`flashcard${flipped ? ' flipped' : ''}`} onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Показать вопрос' : 'Показать ответ'} id="flashcard">
              {!flipped ? (
                <span className="fc-front">
                  <span className="fc-kind">{card.kind === 'formula' ? 'Вспомните формулу' : TYPE_LABEL[card.q.type]}</span>
                  {card.kind === 'formula' ? (
                    <>
                      <b className="fc-title">{card.f.title}</b>
                      {card.f.conditions ? <span className="muted"><Rich inline text={card.f.conditions} /></span> : null}
                    </>
                  ) : (
                    <Rich text={card.q.prompt} />
                  )}
                  <span className="fc-tap">Нажмите, чтобы перевернуть</span>
                </span>
              ) : (
                <span className="fc-back">
                  {card.kind === 'formula' ? (
                    <>
                      <Tex tex={card.f.tex} display />
                      <Legend symbols={card.f.symbols} />
                    </>
                  ) : (
                    <>
                      <span className="label">Ответ</span>
                      <CorrectAnswer q={card.q} />
                      <Rich text={card.q.explanation} />
                    </>
                  )}
                </span>
              )}
            </button>
            <div className="row-actions">
              <Button kind="secondary" icon="refresh" onClick={() => mark('learn')}>Повторить</Button>
              <Button icon="check" onClick={() => mark('know')}>Знаю</Button>
            </div>
            <div className="run-nav">
              <Button kind="ghost" small icon="back" disabled={i === 0} onClick={() => go(-1)}>Назад</Button>
              {user.cardMarks[card.id] ? <Badge tone={user.cardMarks[card.id] === 'know' ? 'ok' : 'warn'}>{user.cardMarks[card.id] === 'know' ? 'знаю' : 'повторить'}</Badge> : <span />}
              <Button kind="ghost" small disabled={i >= deck.length - 1} onClick={() => go(1)}>Дальше</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Mistakes() {
  const idx = useIndex();
  const user = useUser();
  const entries = Object.entries(user.errorQueue)
    .map(([id, e]) => ({ q: idx.entity(id) as Question | undefined, e }))
    .filter((x) => x.q && 'type' in x.q)
    .sort((a, b) => b.e.wrongCount - a.e.wrongCount);
  return (
    <div className="screen">
      <Topbar title="Повторение ошибок" sub={`${entries.length} ${plural(entries.length, 'вопрос', 'вопроса', 'вопросов')} в очереди`} backTo="" />
      <div className="pad stack">
        {entries.length ? (
          <>
            <p className="muted small">Вопрос уходит из очереди после двух верных ответов подряд.</p>
            <Button full icon="refresh" onClick={() => navigate('test/mistakes')}>Повторить ошибки</Button>
            <ul className="list">
              {entries.map(({ q, e }) => (
                <li key={q!.id} className="row static">
                  <span className="row-main">
                    <Rich inline text={q!.prompt.length > 120 ? q!.prompt.slice(0, 120) + '…' : q!.prompt} />
                    <span className="muted">{idx.topic(q!.topicId)?.title} · ошибок: {e.wrongCount}{e.correctStreak ? ` · верно подряд: ${e.correctStreak}` : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty icon="check" title="Ошибок нет">Вопросы, на которые вы ответите неверно, появятся здесь.</Empty>
        )}
      </div>
    </div>
  );
}

export function Favorites() {
  const idx = useIndex();
  const user = useUser();
  const [tab, setTab] = useState<'question' | 'formula' | 'topic'>('question');
  const of = (t: string) => user.bookmarks.filter((b) => b.type === t);
  const qs = of('question').map((b) => idx.entity(b.id)).filter((x): x is Question => !!x && 'type' in x);
  const fs = of('formula').map((b) => idx.entity(b.id)).filter((x): x is Formula => !!x && 'tex' in x);
  const ts = of('topic').map((b) => idx.topic(b.id)).filter(Boolean);
  return (
    <div className="screen">
      <Topbar title="Избранное" backTo="" />
      <div className="pad stack">
        <Segmented label="Тип записей" value={tab} onChange={setTab} options={[{ value: 'question', label: 'Вопросы', count: qs.length }, { value: 'formula', label: 'Формулы', count: fs.length }, { value: 'topic', label: 'Темы', count: ts.length }]} />
        {tab === 'question' ? (
          qs.length ? (
            <>
              <Button full icon="test" onClick={() => navigate('test/favorites')}>Тест по избранным вопросам</Button>
              <ul className="list">
                {qs.map((q) => (
                  <li key={q.id} className="row static">
                    <span className="row-main"><Rich inline text={q.prompt.length > 140 ? q.prompt.slice(0, 140) + '…' : q.prompt} /><span className="muted">{idx.topic(q.topicId)?.title}</span></span>
                    <button className="icon-btn star on" onClick={() => toggleBookmark('question', q.id)} aria-label="Убрать из избранного"><Icon name="star" filled /></button>
                  </li>
                ))}
              </ul>
            </>
          ) : <Empty icon="star" title="Нет сохранённых вопросов">Нажмите звёздочку у вопроса во время теста.</Empty>
        ) : null}
        {tab === 'formula' ? (fs.length ? fs.map((f) => <FormulaCard key={f.id} f={f} compact />) : <Empty icon="star" title="Нет сохранённых формул">Нажмите звёздочку у формулы в теме.</Empty>) : null}
        {tab === 'topic' ? (
          ts.length ? (
            <ul className="list">{ts.map((t) => <li key={t!.id}><Link to={`topic/${t!.id}`} className="row"><span className="row-main"><b>{t!.title}</b></span><Icon name="next" /></Link></li>)}</ul>
          ) : <Empty icon="star" title="Нет сохранённых тем">Нажмите звёздочку в заголовке темы.</Empty>
        ) : null}
      </div>
    </div>
  );
}
