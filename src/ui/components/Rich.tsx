// Отображение формул (KaTeX) и текста с простой разметкой: абзацы, списки «- » и «1. », таблицы «| … |»,
// **жирный**, $формулы$.

import katex from 'katex';
import { Fragment, type ReactNode } from 'react';
import { splitMath } from '../../domain/latex';
import { labelPageRefs } from '../../domain/page-label';

const cache = new Map<string, string>();

export function renderTex(tex: string, display: boolean): string {
  const key = (display ? 'D' : 'I') + tex;
  let html = cache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
    } catch {
      html = `<code>${tex.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</code>`;
    }
    if (cache.size > 3000) cache.clear();
    cache.set(key, html);
  }
  return html;
}

/** Формула. Блочная формула прокручивается по горизонтали на узких экранах, не растягивая страницу. */
export function Tex({ tex, display = false, className }: { tex: string; display?: boolean; className?: string }) {
  if (display) {
    return <div className={`tex-block ${className ?? ''}`} tabIndex={0} role="math" aria-label={tex} dangerouslySetInnerHTML={{ __html: renderTex(tex, true) }} />;
  }
  return <span className={`tex-inline ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: renderTex(tex, false) }} />;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  splitMath(text).forEach((seg, i) => {
    if (seg.kind === 'math') {
      out.push(<Tex key={`${key}m${i}`} tex={seg.value} display={seg.display} />);
      return;
    }
    // **жирный**
    labelPageRefs(seg.value).split(/(\*\*[^*]+\*\*)/g).forEach((part, j) => {
      if (!part) return;
      if (part.startsWith('**') && part.endsWith('**')) out.push(<strong key={`${key}b${i}-${j}`}>{part.slice(2, -2)}</strong>);
      else out.push(<Fragment key={`${key}t${i}-${j}`}>{part}</Fragment>);
    });
  });
  return out;
}

/** Текст с разметкой. inline — без абзацев (для вариантов ответа, заголовков). */
export function Rich({ text, inline: isInline = false, className }: { text: string; inline?: boolean; className?: string }) {
  if (isInline) return <span className={className}>{inline(text, 'r')}</span>;
  const lines = text.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered: string[] = [];
  let table: string[][] = [];
  const flushList = () => {
    if (list.length) {
      const items = list;
      blocks.push(
        <ul key={`ul${blocks.length}`}>
          {items.map((it, i) => (
            <li key={i}>{inline(it, `li${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (ordered.length) {
      const items = ordered;
      blocks.push(
        <ol key={`ol${blocks.length}`}>
          {items.map((it, i) => (
            <li key={i}>{inline(it, `oli${blocks.length}-${i}`)}</li>
          ))}
        </ol>,
      );
      ordered = [];
    }
    if (table.length) {
      const [head, ...rows] = table;
      const k = blocks.length;
      blocks.push(
        <div key={`tb${k}`} className="rich-table" tabIndex={0}>
          <table>
            <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, `th${k}-${i}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, `td${k}-${i}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      table = [];
    }
  };
  for (const l of lines) {
    const t = l.trim();
    const kind = t.startsWith('- ') ? 'ul' : /^\d+\.\s/.test(t) ? 'ol' : t.startsWith('|') && t.endsWith('|') ? 'table' : 'p';
    if ((kind !== 'ul' && list.length) || (kind !== 'ol' && ordered.length) || (kind !== 'table' && table.length)) flushList();
    if (kind === 'ul') list.push(t.slice(2));
    else if (kind === 'ol') ordered.push(t.replace(/^\d+\.\s+/, ''));
    else if (kind === 'table') {
      const cells = t.slice(1, -1).split('|').map((c) => c.trim());
      if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) table.push(cells);
    } else blocks.push(<p key={`p${blocks.length}`}>{inline(t, `p${blocks.length}`)}</p>);
  }
  flushList();
  return <div className={`rich ${className ?? ''}`}>{blocks}</div>;
}
