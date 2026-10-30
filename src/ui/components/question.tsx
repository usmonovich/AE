// Вопрос: ввод ответа для всех типов, подсказка, повторная попытка, объяснение.

import { useEffect, useMemo, useState } from 'react';
import { Rich, Tex } from './Rich';
import { Icon } from './Icon';
import { Badge, Button, Notice } from './ui';
import { FormulaCard, SourceChips, StatusBadge } from './content';
import { useIndex, useUser, useSubject } from '../../data/store';
import { isBookmarked, toggleBookmark, submitAnswer, answerEvent } from '../../data/actions';
import { isComplete, parseNumber } from '../../domain/answer-check';
import { mulberry32, shuffle } from '../../domain/random';
import { cyrb53 } from '../../domain/hash';
import type { AttemptAnswer, Formula, Question, Response } from '../../domain/types';

export const TYPE_LABEL: Record<Question['type'], string> = {
  single: 'Один ответ', multiple: 'Несколько ответов', numeric: 'Числовой ответ', matching: 'Соответствие', sequence: 'Последовательность', text: 'Ответ своими словами',
};

const rndFor = (seed: number, id: string) => mulberry32((seed ^ parseInt(cyrb53(id).slice(-7), 36)) >>> 0);

export function emptyResponse(q: Question, seed: number): Response {
  switch (q.type) {
    case 'single': return { type: 'single', key: '' };
    case 'multiple': return { type: 'multiple', keys: [] };
    case 'numeric': return { type: 'numeric', raw: '' };
    case 'matching': return { type: 'matching', map: {} };
    case 'sequence': {
      const ids = q.sequence!.map((_, i) => String(i));
      let order = shuffle(ids, rndFor(seed, q.id));
      if (order.every((k, i) => k === ids[i]) && ids.length > 1) order = [...ids.slice(1), ids[0]];
      return { type: 'sequence', order };
    }
    case 'text': return { type: 'text', text: '' };
  }
}

export function QuestionInput({ q, value, onChange, disabled, seed }: { q: Question; value: Response; onChange: (r: Response) => void; disabled: boolean; seed: number }) {
  const options = useMemo(() => (q.options ? shuffle(q.options, rndFor(seed, q.id)) : []), [q, seed]);
  const rightSide = useMemo(() => (q.pairs ? shuffle(q.pairs.map((p, i) => ({ key: String(i), body: p[1] })), rndFor(seed + 1, q.id)) : []), [q, seed]);
  const name = `q-${q.id}`;

  if (q.type === 'single' && value.type === 'single') {
    return (
      <fieldset className="options" disabled={disabled}>
        <legend className="sr-only">Выберите один ответ</legend>
        {options.map((o) => (
          <label key={o.key} className={`option${value.key === o.key ? ' on' : ''}`}>
            <input type="radio" name={name} id={`${name}-${o.key}`} checked={value.key === o.key} onChange={() => onChange({ type: 'single', key: o.key })} />
            <span className="mark" aria-hidden="true" />
            <Rich inline text={o.body} />
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.type === 'multiple' && value.type === 'multiple') {
    const toggle = (k: string) => onChange({ type: 'multiple', keys: value.keys.includes(k) ? value.keys.filter((x) => x !== k) : [...value.keys, k] });
    return (
      <fieldset className="options" disabled={disabled}>
        <legend className="hint-line">Выберите все верные варианты</legend>
        {options.map((o) => (
          <label key={o.key} className={`option multi${value.keys.includes(o.key) ? ' on' : ''}`}>
            <input type="checkbox" id={`${name}-${o.key}`} checked={value.keys.includes(o.key)} onChange={() => toggle(o.key)} />
            <span className="mark" aria-hidden="true" />
            <Rich inline text={o.body} />
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.type === 'numeric' && value.type === 'numeric') {
    const bad = value.raw.trim() !== '' && Number.isNaN(parseNumber(value.raw));
    return (
      <div className="numeric">
        <label className="field" htmlFor={`${name}-num`}>
          <span>Ответ{q.numeric?.unit ? ` в ${q.numeric.unit}` : ''}</span>
          <span className="numeric-row">
            <input
              id={`${name}-num`} inputMode="decimal" autoComplete="off" disabled={disabled} value={value.raw}
              onChange={(e) => onChange({ type: 'numeric', raw: e.target.value })} placeholder="например, 4,5 или 3·10^5" aria-invalid={bad}
            />
            {q.numeric?.unit ? <span className="unit-tag">{q.numeric.unit}</span> : null}
          </span>
        </label>
        {bad ? <p className="field-error">Введите число: цифры, запятая или точка; степень — как 10^5.</p> : <p className="hint-line">Допуск ±{Math.round((q.numeric?.tol ?? 0.02) * 100)} %, можно округлять.</p>}
      </div>
    );
  }
  if (q.type === 'matching' && value.type === 'matching') {
    return (
      <div className="matching">
        {q.pairs!.map((p, i) => (
          <label key={i} className="match-row" htmlFor={`${name}-m${i}`}>
            <span className="match-left"><Rich inline text={p[0]} /></span>
            <select id={`${name}-m${i}`} disabled={disabled} value={value.map[String(i)] ?? ''} onChange={(e) => onChange({ type: 'matching', map: { ...value.map, [String(i)]: e.target.value } })}>
              <option value="">— выберите —</option>
              {rightSide.map((r) => (
                <option key={r.key} value={r.key}>{plainForSelect(r.body)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'sequence' && value.type === 'sequence') {
    const move = (i: number, d: -1 | 1) => {
      const o = value.order.slice();
      const j = i + d;
      if (j < 0 || j >= o.length) return;
      [o[i], o[j]] = [o[j], o[i]];
      onChange({ type: 'sequence', order: o });
    };
    return (
      <ol className="sequence">
        {value.order.map((k, i) => (
          <li key={k}>
            <span className="seq-n">{i + 1}</span>
            <span className="seq-body"><Rich inline text={q.sequence![Number(k)]} /></span>
            <span className="seq-tools">
              <button className="icon-btn" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Выше"><Icon name="up" size={18} /></button>
              <button className="icon-btn" disabled={disabled || i === value.order.length - 1} onClick={() => move(i, 1)} aria-label="Ниже"><Icon name="down" size={18} /></button>
            </span>
          </li>
        ))}
      </ol>
    );
  }
  if (q.type === 'text' && value.type === 'text') {
    return (
      <label className="field" htmlFor={`${name}-text`}>
        <span>Ваш ответ</span>
        <textarea id={`${name}-text`} rows={4} disabled={disabled} value={value.text} onChange={(e) => onChange({ type: 'text', text: e.target.value })} />
      </label>
    );
  }
  return null;
}

/** Для <option> нельзя использовать разметку — показываем формулу в упрощённом виде. */
function plainForSelect(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, (_, t: string) =>
      t.replace(/\\upsilon/g, 'υ').replace(/\\nu/g, 'ν').replace(/\\omega/g, 'ω').replace(/\\varphi/g, 'φ').replace(/\\vec\s*/g, '')
        .replace(/\\text\{([^}]*)\}/g, '$1').replace(/\\cdot/g, '·').replace(/\\Rightarrow/g, '⇒').replace(/\\[a-zA-Z]+/g, '').replace(/[{}]/g, ''),
    )
    .replace(/\*\*/g, '');
}

export function CorrectAnswer({ q }: { q: Question }) {
  switch (q.type) {
    case 'single': {
      const o = q.options!.find((x) => x.key === q.answer);
      return <Rich inline text={o?.body ?? ''} />;
    }
    case 'multiple':
      return (
        <ul className="answer-list">
          {q.options!.filter((o) => (q.answer as string[]).includes(o.key)).map((o) => (
            <li key={o.key}><Rich inline text={o.body} /></li>
          ))}
        </ul>
      );
    case 'numeric':
      return <span className="num-answer">{fmtNum(q.numeric!.value)} {q.numeric!.unit}</span>;
    case 'matching':
      return (
        <ul className="answer-list">
          {q.pairs!.map((p, i) => (
            <li key={i}><Rich inline text={p[0]} /> → <Rich inline text={p[1]} /></li>
          ))}
        </ul>
      );
    case 'sequence':
      return (
        <ol className="answer-list">
          {q.sequence!.map((s, i) => (
            <li key={i}><Rich inline text={s} /></li>
          ))}
        </ol>
      );
    case 'text':
      return <Rich text={q.reference ?? ''} />;
  }
}

export const fmtNum = (v: number) => {
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0)) {
    const [m, e] = v.toExponential(2).split('e');
    return `${Number(m).toLocaleString('ru-RU')}·10^${Number(e)}`;
  }
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
};

export function Explanation({ q, verdict }: { q: Question; verdict?: 'correct' | 'wrong' | 'revealed' | null }) {
  const idx = useIndex();
  const formulas = q.formulaIds.map((id) => idx.entity(id)).filter(Boolean) as Formula[];
  const sol = q.solution;
  const meta = useSubject();
  return (
    <section className="explain" aria-label="Объяснение ответа">
      <h3>Объяснение ответа</h3>
      <div className="explain-answer">
        <span className="label">{verdict === 'correct' ? 'Ваш ответ верный' : 'Правильный ответ'}</span>
        <CorrectAnswer q={q} />
      </div>
      {q.type === 'text' && q.criteria?.length ? (
        <div className="criteria">
          <span className="label">Критерии проверки</span>
          <ul>{q.criteria.map((c, i) => <li key={i}><Rich inline text={c} /></li>)}</ul>
        </div>
      ) : null}
      <Rich text={q.explanation} />
      {sol ? (
        <div className="solution">
          {sol.given?.length ? <p><b>Дано:</b> {sol.given.join('; ')}</p> : null}
          {sol.si?.length ? <p><b>Перевод в СИ:</b> {sol.si.join('; ')}</p> : null}
          {sol.find ? <p><b>Найти:</b> {sol.find}</p> : null}
          {sol.formula ? <div className="sol-row"><b>Формула:</b><Tex tex={sol.formula} display /></div> : null}
          {sol.calc ? <div className="sol-row"><b>Подстановка и вычисление:</b><Tex tex={sol.calc} display /></div> : null}
          {sol.method ? <p><b>Метод:</b> <Rich inline text={sol.method} /></p> : null}
          {sol.steps?.length ? <ol className="steps">{sol.steps.map((x, i) => <li key={i}><Rich inline text={x} /></li>)}</ol> : null}
          {sol.check ? <p><b>Проверка:</b> <Rich inline text={sol.check} /></p> : null}
          {sol.answer ? <p className="sol-answer"><b>Ответ:</b> {sol.answer}</p> : null}
        </div>
      ) : null}
      {formulas.length ? (
        <details className="used-formulas">
          <summary>Формулы {meta.style === 'book' ? 'темы' : meta.v.fromSrc} ({formulas.length})</summary>
          {formulas.map((f) => <FormulaCard key={f.id} f={f} compact />)}
        </details>
      ) : null}
      <SourceChips sources={q.sources} web={q.web} generated={q.generated} />
      {q.generated && meta.style !== 'book' ? <p className="muted small">{q.web ? `Вопрос составлен по материалу из интернета, которого нет ${meta.v.inSrc} (добавлен по просьбе владельца).` : `Вопрос составлен ${meta.v.bySrc}; ${meta.v.inSrc} такого задания нет.`}</p> : null}
    </section>
  );
}

/** Один вопрос внутри попытки: ввод → проверка → подсказка → повтор → разбор. */
export function QuestionFlow({
  q, attemptId, seed, answer, exam, onNext, isLast, number, total,
}: {
  q: Question; attemptId: string; seed: number; answer?: AttemptAnswer; exam: boolean; onNext: () => void; isLast: boolean; number: number; total: number;
}) {
  const user = useUser();
  const status = answer?.status ?? 'unanswered';
  const final = status === 'correct' || status === 'wrong' || status === 'revealed';
  const last = answer?.responses[answer.responses.length - 1];
  const [draft, setDraft] = useState<Response>(() => last ?? emptyResponse(q, seed));
  useEffect(() => {
    setDraft(answer?.responses[answer.responses.length - 1] ?? emptyResponse(q, seed));
  }, [q.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const starred = isBookmarked(user, 'question', q.id);
  const canSubmit = !final && status !== 'selfcheck' && isComplete(q, draft);
  const idx = useIndex();
  const topic = idx.topic(q.topicId);

  return (
    <article className="qcard" aria-labelledby={`qt-${q.id}`}>
      <div className="qcard-meta">
        <span className="qnum">Вопрос {number} из {total}</span>
        <span className="qtype">{TYPE_LABEL[q.type]}</span>
        <StatusBadge status={q.status} web={!!q.web} />
        <button className={`icon-btn star${starred ? ' on' : ''}`} onClick={() => toggleBookmark('question', q.id)} aria-pressed={starred} aria-label={starred ? 'Убрать из избранного' : 'Сохранить вопрос в избранное'}>
          <Icon name="star" filled={starred} size={18} />
        </button>
      </div>
      <p className="qtopic">{topic?.title}</p>
      <div className="qprompt" id={`qt-${q.id}`}><Rich text={q.prompt} /></div>

      <QuestionInput q={q} value={draft} onChange={setDraft} disabled={final || status === 'selfcheck' || (exam && status !== 'unanswered')} seed={seed} />

      {status === 'hint' ? (
        <div className="hintbox" role="alert">
          <p className="verdict bad"><Icon name="x" size={18} /> Неверно. Попробуйте ещё раз.</p>
          <p className="hint-title"><Icon name="bulb" size={16} /> Подсказка</p>
          <Rich text={q.hints[0]} />
        </div>
      ) : null}

      {status === 'selfcheck' ? (
        <div className="selfcheck">
          <p className="label">Сверьте свой ответ с эталоном</p>
          <div className="reference"><Rich text={q.reference ?? ''} /></div>
          {q.criteria?.length ? <ul className="criteria-list">{q.criteria.map((c, i) => <li key={i}><Rich inline text={c} /></li>)}</ul> : null}
          <p className="muted small">Формулировка может отличаться — важно, чтобы совпадал смысл.</p>
          <div className="row-actions">
            <Button kind="secondary" icon="x" onClick={() => answerEvent(attemptId, q, { type: 'selfAssess', correct: false })}>Смысл не совпадает</Button>
            <Button icon="check" onClick={() => answerEvent(attemptId, q, { type: 'selfAssess', correct: true })}>Мой ответ верный</Button>
          </div>
        </div>
      ) : null}

      {final && !exam ? (
        <>
          <p className={`verdict ${status === 'correct' ? 'ok' : 'bad'}`} role="status">
            <Icon name={status === 'correct' ? 'check' : 'x'} size={20} />
            {status === 'correct'
              ? answer!.tries > 1 ? 'Верно со второй попытки' : 'Верно'
              : status === 'revealed' ? 'Решение показано' : 'Неверно'}
          </p>
          <Explanation q={q} verdict={status as 'correct' | 'wrong' | 'revealed'} />
        </>
      ) : null}

      {exam && status !== 'unanswered' ? <Notice tone="info">Ответ принят. Разбор будет после завершения экзамена.</Notice> : null}

      <div className="qactions">
        {!final && status !== 'selfcheck' && !(exam && status !== 'unanswered') ? (
          <>
            <Button id="submit-answer" onClick={() => submitAnswer(attemptId, q, draft)} disabled={!canSubmit} icon="check">
              {q.type === 'text' ? 'Сверить с эталоном' : status === 'hint' ? 'Ответить ещё раз' : 'Ответить'}
            </Button>
            {!exam ? <Button kind="ghost" icon="eye" onClick={() => answerEvent(attemptId, q, { type: 'reveal' })}>Показать решение</Button> : null}
          </>
        ) : null}
        {final || (exam && status !== 'unanswered') ? (
          <Button id="next-question" onClick={onNext} icon={isLast ? 'flag' : 'next'}>{isLast ? 'Завершить и посмотреть результат' : 'Следующий вопрос'}</Button>
        ) : null}
      </div>
    </article>
  );
}

/** Вопрос в режиме «вопрос — ответ»: без проверки, ответ открывается по кнопке. */
export function QAItem({ q, n }: { q: Question; n: number }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="qa">
      <div className="qa-head">
        <span className="qnum">{n}</span>
        <Badge tone="muted">{TYPE_LABEL[q.type]}</Badge>
        <StatusBadge status={q.status} web={!!q.web} />
      </div>
      <Rich text={q.prompt} />
      {q.type === 'single' || q.type === 'multiple' ? (
        <ul className="qa-options">{q.options!.map((o) => <li key={o.key}><Rich inline text={o.body} /></li>)}</ul>
      ) : null}
      {q.type === 'matching' ? <ul className="qa-options">{q.pairs!.map((p, i) => <li key={i}><Rich inline text={p[0]} /></li>)}</ul> : null}
      <Button kind="secondary" small icon={open ? 'up' : 'eye'} onClick={() => setOpen(!open)}>{open ? 'Скрыть ответ' : 'Показать ответ'}</Button>
      {open ? <Explanation q={q} /> : null}
    </article>
  );
}
