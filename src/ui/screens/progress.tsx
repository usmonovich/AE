// Личный кабинет: прогресс по курсу, история попыток, слабые темы, динамика.

import { useState } from 'react';
import { useIndex, useUser } from '../../data/store';
import { overview, dailySeries, type DayPoint } from '../../domain/progress';
import { Topbar, Link, Progress, Segmented, Empty, Badge, plural, fmtDate } from '../components/ui';
import { Icon } from '../components/Icon';

export function ProgressScreen() {
  const idx = useIndex();
  const user = useUser();
  const ov = overview(user, idx);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [openSub, setOpenSub] = useState<string | null>(null);
  const series = dailySeries(user, Number(days));

  return (
    <div className="screen">
      <Topbar title="Мой прогресс" backTo="" />
      <div className="pad stack">
        <dl className="stat-grid big">
          <div><dt>Изучено тем</dt><dd>{ov.topicsStudied}<small>/{ov.topicsTotal}</small></dd></div>
          <div><dt>Пройдено тестов</dt><dd>{ov.testsCompleted}</dd></div>
          <div><dt>Верных ответов</dt><dd>{ov.percentCorrect === null ? '—' : `${ov.percentCorrect}%`}</dd></div>
          <div><dt>Верно / неверно</dt><dd>{ov.answersCorrect}<small> / {ov.answersWrong}</small></dd></div>
        </dl>

        <section className="card">
          <div className="block-head">
            <h2>Доля верных ответов по дням</h2>
            <Segmented label="Период" value={days} onChange={setDays} options={[{ value: '7', label: '7 дн.' }, { value: '30', label: '30 дн.' }, { value: '90', label: '90 дн.' }]} />
          </div>
          <DailyChart points={series} />
        </section>

        <section className="card">
          <h2>По разделам и темам</h2>
          {ov.sections.map((s) => (
            <div key={s.id} className="prog-section">
              <div className="prog-row strong">
                <span>{s.title}</span>
                <span className="muted">{s.percent}% · {s.accuracy.percent === null ? 'тестов не было' : `верных ${s.accuracy.percent}%`}</span>
              </div>
              <Progress value={s.percent} label={`Изучено: ${s.title}`} tone="accent" />
              {s.subsections.map((ss) => (
                <div key={ss.id} className="prog-sub">
                  <button className="prog-row" onClick={() => setOpenSub(openSub === ss.id ? null : ss.id)} aria-expanded={openSub === ss.id}>
                    <span>{ss.title}</span>
                    <span className="muted">{ss.studied}/{ss.topics}{ss.accuracy.percent !== null ? ` · ${ss.accuracy.percent}%` : ''} <Icon name={openSub === ss.id ? 'up' : 'down'} size={14} /></span>
                  </button>
                  <Progress value={ss.percent} label={`Изучено: ${ss.title}`} />
                  {openSub === ss.id ? (
                    <ul className="prog-topics">
                      {ss.rows.map((r) => (
                        <li key={r.topicId}>
                          <Link to={`topic/${r.topicId}`} className="prog-topic">
                            <span className={`dotmark${r.studied ? ' on' : ''}`} aria-label={r.studied ? 'изучено' : 'не изучено'} />
                            <span>{r.title}</span>
                            <span className="muted">{r.accuracy.percent === null ? '—' : `${r.accuracy.percent}% из ${r.accuracy.answered}`}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="card">
          <h2>Темы с частыми ошибками</h2>
          {ov.weakTopics.length ? (
            <ul className="list">
              {ov.weakTopics.map((r) => (
                <li key={r.topicId}>
                  <Link to={`topic/${r.topicId}`} className="row">
                    <span className="row-main"><b>{r.title}</b><span className="muted">верных {r.accuracy.percent}% из {r.accuracy.answered} ответов</span></span>
                    <Icon name="next" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Появятся, когда в теме будет хотя бы 3 ответа и есть ошибки.</p>
          )}
          <p className="small">
            <Link to="mistakes">Повторение ошибок: {ov.mistakes}</Link> · <Link to="favorites">Избранное: {ov.bookmarks}</Link>
          </p>
        </section>

        <section className="card">
          <h2>История попыток</h2>
          {ov.history.length ? (
            <ul className="history">
              {ov.history.slice(0, 50).map(({ attempt, score }) => {
                const retry = ov.retries.find((r) => r.attempt.id === attempt.id);
                return (
                  <li key={attempt.id}>
                    <Link to={`result/${attempt.id}`} className="history-row">
                      <span className={`pct ${score.percent >= 80 ? 'good' : score.percent >= 50 ? 'mid' : 'low'}`}>{score.percent}%</span>
                      <span className="row-main">
                        <b>{attempt.title}</b>
                        <span className="muted">{fmtDate(attempt.finishedAt!)} · {score.correct}/{score.total} · {attempt.config.order === 'source' ? 'по порядку' : 'случайно'}</span>
                      </span>
                      {retry ? <Badge tone={retry.delta >= 0 ? 'ok' : 'bad'} title="Повторная попытка: изменение к предыдущей">{retry.delta >= 0 ? '+' : ''}{retry.delta}</Badge> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon="history" title="Попыток пока нет">Пройдите первый тест — результаты появятся здесь.</Empty>
          )}
        </section>
        <p className="muted small">Сбросить прогресс можно в <Link to="settings">настройках</Link>.</p>
      </div>
    </div>
  );
}

/** Линейный график доли верных ответов: один ряд, разрывы в днях без ответов, подсказка при наведении. */
export function DailyChart({ points }: { points: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 200, L = 40, R = 12, T = 12, B = 28;
  const x = (i: number) => L + (points.length <= 1 ? 0 : (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const withData = points.map((p, i) => ({ p, i })).filter((d) => d.p.percent !== null);
  if (!withData.length) return <Empty icon="chart" title="Нет ответов за период">График появится после первых тестов.</Empty>;
  // разрываем линию на днях без данных
  const segs: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.percent === null) { if (cur) segs.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.percent).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const lastD = withData[withData.length - 1];
  const label = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const ticks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const h = hover !== null ? points[hover] : null;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Доля верных ответов по дням" onMouseLeave={() => setHover(null)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}%</text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="axis">{label(points[i].date)}</text>
        ))}
        {segs.map((d, k) => <path key={k} d={d} className="line" fill="none" />)}
        {withData.map(({ p, i }) => <circle key={i} cx={x(i)} cy={y(p.percent!)} r={i === lastD.i ? 5 : 4} className={`pt${i === lastD.i ? ' last' : ''}`} />)}
        {hover !== null && h ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" /> : null}
        {points.map((_, i) => (
          <rect key={i} x={x(i) - (W - L - R) / points.length / 2} y={T} width={(W - L - R) / points.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      <figcaption className="chart-tip" aria-live="polite">
        {h ? (h.total ? <>{label(h.date)}: <b>{h.percent}%</b> верных ({h.correct} из {h.total})</> : <>{label(h.date)}: ответов не было</>) : <>Последний день с ответами: {label(lastD.p.date)} — <b>{lastD.p.percent}%</b></>}
      </figcaption>
      <details className="chart-table">
        <summary>Таблица значений</summary>
        <table>
          <thead><tr><th>День</th><th>Ответов</th><th>Верно</th><th>%</th></tr></thead>
          <tbody>{withData.map(({ p }) => <tr key={p.date}><td>{label(p.date)}</td><td>{p.total}</td><td>{p.correct}</td><td>{p.percent}%</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}
