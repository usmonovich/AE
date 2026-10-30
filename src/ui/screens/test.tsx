// Тестирование: настройка, прохождение, результаты.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useIndex, useUser, useAdmin, useSubject } from '../../data/store';
import { ADMIN_ENABLED } from '../../data/build-flags';
import { startAttempt, goTo, finishAttempt, checkDeadline, getAttempt } from '../../data/actions';
import { availableQuestions, attemptScore, defaultConfig } from '../../domain/test-engine';
import type { AttemptMode, QuestionCategory, QuestionType, TestConfig } from '../../domain/types';
import { Topbar, Button, Chip, Notice, Switch, Confirm, Empty, Link, Badge, plural, fmtDate } from '../components/ui';
import { Icon } from '../components/Icon';
import { QuestionFlow, TYPE_LABEL, Explanation } from '../components/question';
import { Rich } from '../components/Rich';
import { navigate } from '../router';
import { isFinal } from '../../domain/hint-flow';
import { NotFound } from './learn';

const ALL_TYPES: QuestionType[] = ['single', 'multiple', 'numeric', 'matching', 'sequence', 'text'];
const CATS: { v: QuestionCategory; label: string }[] = [
  { v: 'theory', label: 'Теория' }, { v: 'formula', label: 'Формулы' }, { v: 'problem', label: 'Расчётные задачи' },
];
const MODE_TITLE: Record<AttemptMode, string> = {
  test: 'Тест', exam: 'Экзамен', mistakes: 'Повторение ошибок', favorites: 'Избранные вопросы', formulas: 'Тренировка формул', problems: 'Практика задач', review: 'Повторение пройденного',
};

export function TestSetup({ preset, id }: { preset?: string; id?: string }) {
  const meta = useSubject();
  const idx = useIndex();
  const user = useUser();
  const admin = useAdmin();
  const allTopics = idx.allVisibleTopics();

  const init = useMemo(() => {
    const cfg: TestConfig = { ...defaultConfig(allTopics.map((t) => t.id)), includeReview: admin.previewReview };
    let mode: AttemptMode = 'test';
    let title = 'Весь курс';
    let restrict: string[] | undefined;
    if (preset === 'topic' && id) { cfg.topicIds = [id]; title = `Тема: ${idx.topic(id)?.title}`; }
    else if (preset === 'sub' && id) { cfg.topicIds = idx.topicsOf(id).map((t) => t.id); title = `Подраздел: ${idx.subsection(id)?.title}`; cfg.count = 20; }
    else if (preset === 'section' && id) { cfg.topicIds = idx.topicsOfSection(id).map((t) => t.id); title = `Раздел: ${idx.section(id)?.title}`; cfg.count = 20; }
    else if (preset === 'exam') { mode = 'exam'; title = 'Экзамен'; Object.assign(cfg, { count: 20, order: 'random', timeLimitSec: 1800, hints: false }); }
    else if (preset === 'problems') { mode = 'problems'; title = 'Практика задач'; Object.assign(cfg, { categories: ['problem'], types: ['numeric'] }); }
    else if (preset === 'formulas') { mode = 'formulas'; title = 'Тренировка формул'; Object.assign(cfg, { categories: ['formula'] }); }
    else if (preset === 'review') {
      mode = 'review'; title = 'Повторение пройденного';
      cfg.topicIds = allTopics.filter((t) => user.topicProgress[t.id]?.studiedAt).map((t) => t.id);
      cfg.order = 'random';
    } else if (preset === 'mistakes') { mode = 'mistakes'; title = 'Повторение ошибок'; restrict = Object.keys(user.errorQueue); cfg.count = 0; }
    else if (preset === 'favorites') { mode = 'favorites'; title = 'Избранные вопросы'; restrict = user.bookmarks.filter((b) => b.type === 'question').map((b) => b.id); cfg.count = 0; }
    return { cfg, mode, title, restrict };
  }, [preset, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [cfg, setCfg] = useState<TestConfig>(init.cfg);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => setCfg(init.cfg), [init]);
  const set = (p: Partial<TestConfig>) => setCfg((c) => ({ ...c, ...p }));
  const available = availableQuestions(idx, cfg, init.restrict).length;
  const effective = cfg.count > 0 ? Math.min(cfg.count, available) : available;
  const selected = new Set(cfg.topicIds);
  const toggleTopics = (ids: string[], on: boolean) => {
    const s = new Set(cfg.topicIds);
    ids.forEach((i) => (on ? s.add(i) : s.delete(i)));
    set({ topicIds: allTopics.map((t) => t.id).filter((t) => s.has(t)) });
  };
  const exam = init.mode === 'exam';

  const start = () => {
    const same = cfg.topicIds.join() === init.cfg.topicIds.join();
    const title = init.restrict || same ? init.title : cfg.topicIds.length === allTopics.length ? 'Весь курс' : `Выбрано тем: ${cfg.topicIds.length}`;
    const a = startAttempt(cfg, init.mode, title, { restrictIds: init.restrict });
    navigate(`run/${a.id}`, { replace: false });
  };

  return (
    <div className="screen">
      <Topbar title={MODE_TITLE[init.mode] === 'Тест' ? 'Новый тест' : MODE_TITLE[init.mode]} sub={init.title} backTo="" />
      <div className="stack pad">
        {!init.restrict ? (
          <fieldset className="card">
            <legend>Область тестирования</legend>
            <div className="chips">
              <Chip on={cfg.topicIds.length === allTopics.length} onClick={() => set({ topicIds: allTopics.map((t) => t.id) })}>Весь курс</Chip>
              <Chip on={cfg.topicIds.length === 0} onClick={() => set({ topicIds: [] })}>Снять всё</Chip>
            </div>
            <div className="tree">
              {idx.activeSections().map((s) => {
                const sTopics = idx.topicsOfSection(s.id).map((t) => t.id);
                const sAll = sTopics.every((t) => selected.has(t));
                return (
                  <div key={s.id} className="tree-section">
                    <label className="tree-row strong">
                      <input type="checkbox" id={`sec-${s.id}`} checked={sAll} ref={(el) => { if (el) el.indeterminate = !sAll && sTopics.some((t) => selected.has(t)); }} onChange={(e) => toggleTopics(sTopics, e.target.checked)} />
                      <span>{s.title}</span>
                    </label>
                    {idx.subsectionsOf(s.id).map((ss) => {
                      const tIds = idx.topicsOf(ss.id).map((t) => t.id);
                      const all = tIds.every((t) => selected.has(t));
                      const some = tIds.some((t) => selected.has(t));
                      return (
                        <div key={ss.id} className="tree-sub">
                          <div className="tree-row">
                            <label>
                              <input type="checkbox" id={`sub-${ss.id}`} checked={all} ref={(el) => { if (el) el.indeterminate = !all && some; }} onChange={(e) => toggleTopics(tIds, e.target.checked)} />
                              <span>{ss.title} <span className="muted">({tIds.filter((t) => selected.has(t)).length}/{tIds.length})</span></span>
                            </label>
                            <button className="icon-btn" onClick={() => setOpen({ ...open, [ss.id]: !open[ss.id] })} aria-expanded={!!open[ss.id]} aria-label={`Темы подраздела ${ss.title}`}>
                              <Icon name={open[ss.id] ? 'up' : 'down'} size={18} />
                            </button>
                          </div>
                          {open[ss.id] ? (
                            <div className="tree-topics">
                              {idx.topicsOf(ss.id).map((t) => (
                                <label key={t.id} className="tree-row small">
                                  <input type="checkbox" id={`t-${t.id}`} checked={selected.has(t.id)} onChange={(e) => toggleTopics([t.id], e.target.checked)} />
                                  <span>{t.title}</span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="card">
          <legend>Количество вопросов</legend>
          <div className="chips">
            {[5, 10, 20, 30].map((n) => <Chip key={n} on={cfg.count === n} onClick={() => set({ count: n })}>{n}</Chip>)}
            <Chip on={cfg.count === 0} onClick={() => set({ count: 0 })}>Все ({available})</Chip>
          </div>
          <label className="field inline" htmlFor="q-count">
            <span>Своё число</span>
            <input id="q-count" type="number" min={1} max={500} value={cfg.count || ''} onChange={(e) => set({ count: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <p className="muted small">Доступно по настройкам: <b>{available}</b>.</p>
          {cfg.count > available && available > 0 ? <Notice tone="warn">Запрошено {cfg.count}, доступно {available}. Тест будет из {available} {plural(available, 'вопроса', 'вопросов', 'вопросов')}.</Notice> : null}
        </fieldset>

        <fieldset className="card">
          <legend>Порядок вопросов</legend>
          <div className="radio-cards">
            <label className={`radio-card${cfg.order === 'source' ? ' on' : ''}`}>
              <input type="radio" name="order" id="order-source" checked={cfg.order === 'source'} onChange={() => set({ order: 'source' })} />
              <b>По порядку</b>
              <span>{meta.style === 'book' ? 'Как в книге: тема за темой, в порядке оглавления.' : `Как ${meta.v.inSrc}: тема за темой, страница за страницей.`}</span>
            </label>
            <label className={`radio-card${cfg.order === 'random' ? ' on' : ''}`}>
              <input type="radio" name="order" id="order-random" checked={cfg.order === 'random'} onChange={() => set({ order: 'random' })} />
              <b>Случайный</b>
              <span>Новый порядок в каждой попытке, без повторов.</span>
            </label>
          </div>
          {cfg.order === 'source' && cfg.count > 0 && cfg.count < available ? (
            <div className="chips">
              <Chip on={cfg.pick === 'first'} onClick={() => set({ pick: 'first' })}>Первые {cfg.count}</Chip>
              <Chip on={cfg.pick === 'random'} onClick={() => set({ pick: 'random' })}>Случайные {cfg.count}, по порядку</Chip>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="card">
          <legend>Формат вопросов</legend>
          <div className="chips">
            {ALL_TYPES.map((t) => (
              <Chip key={t} on={cfg.types.includes(t)} onClick={() => set({ types: cfg.types.includes(t) ? cfg.types.filter((x) => x !== t) : [...cfg.types, t] })}>{TYPE_LABEL[t]}</Chip>
            ))}
          </div>
          <div className="chips">
            {CATS.map((c) => (
              <Chip key={c.v} on={cfg.categories.includes(c.v)} onClick={() => set({ categories: cfg.categories.includes(c.v) ? cfg.categories.filter((x) => x !== c.v) : [...cfg.categories, c.v] })}>{c.label}</Chip>
            ))}
          </div>
          <p className="muted small">Уровни сложности не используются: {meta.v.inSrc} нет оснований для их разметки.</p>
        </fieldset>

        <fieldset className="card">
          <legend>Время и подсказки</legend>
          <div className="chips">
            {[0, 10, 20, 30, 45, 60].map((m) => <Chip key={m} on={cfg.timeLimitSec === m * 60} onClick={() => set({ timeLimitSec: m * 60 })}>{m ? `${m} мин` : 'Без ограничения'}</Chip>)}
          </div>
          <Switch id="hints-switch" checked={cfg.hints} onChange={(v) => set({ hints: v })} label="Подсказка после первой ошибки" hint={exam ? 'В экзамене обычно выключено' : 'После второй ошибки — полный разбор'} />
          {ADMIN_ENABLED && admin.previewReview ? (
            <Switch id="preview-switch" checked={cfg.includeReview} onChange={(v) => set({ includeReview: v })} label="Предпросмотр: включить непроверенные вопросы" hint="Доступно, потому что в админ-панели включён предпросмотр" />
          ) : null}
        </fieldset>

        {available === 0 ? (
          <Notice tone="warn">
            Нет доступных вопросов. {idx.counts().questionsApproved === 0 ? <>Вопросы ждут проверки{ADMIN_ENABLED ? <> в <Link to="admin/review">админ-панели</Link></> : null}.</> : 'Измените область или формат.'}
          </Notice>
        ) : null}
        <Button id="start-test" full icon="flag" disabled={effective === 0 || (!init.restrict && cfg.topicIds.length === 0)} onClick={start}>
          Начать: {effective} {plural(effective, 'вопрос', 'вопроса', 'вопросов')}{cfg.timeLimitSec ? `, ${cfg.timeLimitSec / 60} мин` : ''}
        </Button>
      </div>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TestRun({ id }: { id: string }) {
  const idx = useIndex();
  useUser();
  const a = getAttempt(id);
  const [confirm, setConfirm] = useState(false);
  const now = useNow(!!a?.deadlineAt && !a?.finishedAt);
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (a?.finishedAt) navigate(`result/${id}`, { replace: true });
  }, [a?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (a?.deadlineAt) checkDeadline(id);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <NotFound />;
  if (!a.questionIds.length)
    return (
      <div className="screen">
        <Topbar title={a.title} backTo="test" />
        <Empty title="В тесте нет вопросов">{a.notice}</Empty>
      </div>
    );
  const qid = a.questionIds[a.currentIndex];
  const q = idx.entity(qid);
  const exam = !a.config.hints && a.mode === 'exam';
  const left = a.deadlineAt ? new Date(a.deadlineAt).getTime() - now : null;
  const isLast = a.currentIndex === a.questionIds.length - 1;
  const answered = a.questionIds.filter((x) => isFinal(a.answers[x])).length;
  const next = () => {
    if (isLast) {
      const firstOpen = a.questionIds.findIndex((x) => !isFinal(a.answers[x]));
      if (firstOpen >= 0 && firstOpen !== a.currentIndex) setConfirm(true);
      else finishAttempt(id);
    } else goTo(id, a.currentIndex + 1);
    topRef.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="screen run" ref={topRef}>
      <Topbar
        title={a.title}
        sub={`${MODE_TITLE[a.mode]} · ${a.config.order === 'source' ? 'по порядку' : 'случайный порядок'}`}
        backTo="test"
        actions={
          <>
            {left !== null ? <span className={`timer${left < 60000 ? ' low' : ''}`} role="timer" aria-label="Осталось времени"><Icon name="clock" size={16} />{mmss(left)}</span> : null}
            <button className="icon-btn" onClick={() => setConfirm(true)} aria-label="Завершить тест"><Icon name="flag" /></button>
          </>
        }
      />
      {a.notice ? <Notice tone="warn">{a.notice}</Notice> : null}
      <nav className="dots" aria-label="Вопросы теста">
        {a.questionIds.map((x, i) => {
          const st = a.answers[x]?.status ?? 'unanswered';
          const cls = exam ? (st !== 'unanswered' ? 'done' : '') : st === 'correct' ? 'ok' : st === 'wrong' || st === 'revealed' ? 'bad' : st === 'hint' ? 'hint' : '';
          return <button key={x} className={`dot ${cls}${i === a.currentIndex ? ' cur' : ''}`} onClick={() => goTo(id, i)} aria-label={`Вопрос ${i + 1}`} aria-current={i === a.currentIndex} />;
        })}
      </nav>
      {q && 'type' in q ? (
        <QuestionFlow key={qid} q={q} attemptId={id} seed={a.seed} answer={a.answers[qid]} exam={exam} onNext={next} isLast={isLast} number={a.currentIndex + 1} total={a.questionIds.length} />
      ) : (
        <Notice tone="bad">Вопрос {qid} удалён из учебной базы. Перейдите к следующему.</Notice>
      )}
      <div className="run-nav">
        <Button kind="ghost" small icon="back" disabled={a.currentIndex === 0} onClick={() => goTo(id, a.currentIndex - 1)}>Назад</Button>
        <span className="muted small">Отвечено {answered} из {a.questionIds.length}</span>
        <Button kind="ghost" small disabled={isLast} onClick={() => goTo(id, a.currentIndex + 1)}>Пропустить</Button>
      </div>
      <Confirm
        open={confirm}
        title="Завершить тест?"
        confirmText="Завершить"
        cancelText="Продолжить тест"
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); finishAttempt(id); }}
      >
        <p>Отвечено {answered} из {a.questionIds.length}. Вопросы без ответа будут засчитаны как неверные.</p>
      </Confirm>
    </div>
  );
}

export function Results({ id }: { id: string }) {
  const idx = useIndex();
  useUser();
  const a = getAttempt(id);
  const [open, setOpen] = useState<string | null>(null);
  if (!a) return <NotFound />;
  const s = attemptScore(a);
  const spent = a.finishedAt ? Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000) : 0;
  const wrongIds = a.questionIds.filter((q) => a.answers[q]?.status !== 'correct');
  const retry = () => {
    const n = startAttempt(a.config, a.mode, a.title, { parentId: a.id, restrictIds: a.mode === 'mistakes' || a.mode === 'favorites' ? a.questionIds : undefined });
    navigate(`run/${n.id}`);
  };
  const workOnMistakes = () => {
    const n = startAttempt({ ...a.config, count: 0, timeLimitSec: 0, hints: true }, 'mistakes', `Работа над ошибками: ${a.title}`, { restrictIds: wrongIds, parentId: a.id });
    navigate(`run/${n.id}`);
  };
  const parent = a.parentId ? getAttempt(a.parentId) : undefined;
  return (
    <div className="screen">
      <Topbar title="Результат" sub={`${a.title} · ${a.finishedAt ? fmtDate(a.finishedAt) : 'не завершён'}`} backTo="" />
      <div className="pad stack">
        <div className={`score ${s.percent >= 80 ? 'good' : s.percent >= 50 ? 'mid' : 'low'}`}>
          <b>{s.percent}%</b>
          <span>{s.correct} из {s.total} верно</span>
        </div>
        <dl className="stat-grid">
          <div><dt>С первой попытки</dt><dd>{s.firstTry}</dd></div>
          <div><dt>После подсказки</dt><dd>{s.afterHint}</dd></div>
          <div><dt>Неверно</dt><dd>{s.wrong}</dd></div>
          <div><dt>Показано решение</dt><dd>{s.revealed}</dd></div>
          <div><dt>Без ответа</dt><dd>{s.total - s.answered}</dd></div>
          <div><dt>Время</dt><dd>{mmss(spent * 1000)}</dd></div>
        </dl>
        {parent?.finishedAt ? (
          <Notice tone={s.percent >= attemptScore(parent).percent ? 'ok' : 'info'}>
            Предыдущая попытка: {attemptScore(parent).percent}% → сейчас {s.percent}% ({s.percent - attemptScore(parent).percent >= 0 ? '+' : ''}{s.percent - attemptScore(parent).percent}).
          </Notice>
        ) : null}
        <div className="row-actions wrap">
          <Button icon="refresh" onClick={retry}>{a.config.order === 'random' ? 'Пройти ещё раз (новый порядок)' : 'Пройти ещё раз'}</Button>
          {wrongIds.length ? <Button kind="secondary" icon="target" onClick={workOnMistakes}>Работа над ошибками ({wrongIds.length})</Button> : null}
          <Button kind="ghost" onClick={() => navigate('')}>На главную</Button>
        </div>
        <h2 className="h2">Разбор вопросов</h2>
        <ol className="review-list">
          {a.questionIds.map((qid, i) => {
            const q = idx.entity(qid);
            const st = a.answers[qid]?.status ?? 'unanswered';
            if (!q || !('type' in q)) return <li key={qid} className="muted">Вопрос удалён</li>;
            return (
              <li key={qid} className={`review-item ${st}`}>
                <button className="review-head" onClick={() => setOpen(open === qid ? null : qid)} aria-expanded={open === qid}>
                  <span className={`st-icon ${st}`}><Icon name={st === 'correct' ? 'check' : st === 'unanswered' ? 'clock' : 'x'} size={16} /></span>
                  <span className="review-q"><b>{i + 1}.</b> <Rich inline text={q.prompt.length > 140 ? q.prompt.slice(0, 140) + '…' : q.prompt} /></span>
                  <Badge tone={st === 'correct' ? 'ok' : st === 'unanswered' ? 'muted' : 'bad'}>
                    {st === 'correct' ? (a.answers[qid].tries > 1 ? 'после подсказки' : 'верно') : st === 'revealed' ? 'решение показано' : st === 'unanswered' || st === 'hint' || st === 'selfcheck' ? 'без ответа' : 'неверно'}
                  </Badge>
                </button>
                {open === qid ? <Explanation q={q} verdict={st === 'correct' ? 'correct' : 'wrong'} /> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
