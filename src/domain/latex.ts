// Подготовка LaTeX: кириллица внутри формул оборачивается в \text{…},
// иначе KaTeX рисует её как курсивные математические символы и выдаёт предупреждения.

const CYR = 'А-Яа-яЁё';
const CYR_RUN = new RegExp(`[${CYR}]+(?:\\.[${CYR}]+)*\\.?`, 'g');

/** Оборачивает кириллические фрагменты формулы в {\text{…}}, не трогая уже существующие \text{…}. */
export function normalizeLatex(tex: string): string {
  let out = '';
  let i = 0;
  while (i < tex.length) {
    const textCmd = tex.startsWith('\\text{', i) ? 6 : tex.startsWith('\\mathrm{', i) ? 8 : tex.startsWith('\\operatorname{', i) ? 14 : 0;
    if (textCmd) {
      // копируем \text{...} целиком с учётом вложенных скобок
      let depth = 1;
      let j = i + textCmd;
      while (j < tex.length && depth > 0) {
        if (tex[j] === '{') depth++;
        else if (tex[j] === '}') depth--;
        j++;
      }
      out += tex.slice(i, j);
      i = j;
      continue;
    }
    // ищем ближайший \text{ или конец, обрабатываем кусок между ними
    const next = findNextTextCmd(tex, i);
    const chunk = tex.slice(i, next);
    out += chunk.replace(CYR_RUN, (m) => `{\\text{${m}}}`);
    i = next;
  }
  return out;
}

function findNextTextCmd(tex: string, from: number): number {
  const cands = ['\\text{', '\\mathrm{', '\\operatorname{']
    .map((c) => tex.indexOf(c, from))
    .filter((x) => x >= 0);
  return cands.length ? Math.min(...cands) : tex.length;
}

export type MathSegment = { kind: 'text'; value: string } | { kind: 'math'; value: string; display: boolean };

/** Делит строку на текст и формулы: $$…$$, $…$, \[…\], \(…\). */
export function splitMath(src: string): MathSegment[] {
  const out: MathSegment[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) out.push({ kind: 'text', value: buf });
    buf = '';
  };
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && (src[i + 1] === '(' || src[i + 1] === '[')) {
      const close = src[i + 1] === '(' ? '\\)' : '\\]';
      const end = src.indexOf(close, i + 2);
      if (end > 0) {
        flush();
        out.push({ kind: 'math', value: src.slice(i + 2, end), display: src[i + 1] === '[' });
        i = end + 2;
        continue;
      }
    }
    if (ch === '\\' && src[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (ch === '$') {
      const display = src[i + 1] === '$';
      const open = display ? 2 : 1;
      const end = src.indexOf(display ? '$$' : '$', i + open);
      if (end > 0) {
        flush();
        out.push({ kind: 'math', value: src.slice(i + open, end), display });
        i = end + open;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Нормализует все формулы внутри текста с разметкой. */
export function normalizeMarkdownMath(src: string): string {
  return splitMath(src)
    .map((s) => (s.kind === 'text' ? s.value.replace(/\$/g, '\\$') : s.display ? `$$${normalizeLatex(s.value)}$$` : `$${normalizeLatex(s.value)}$`))
    .join('');
}

/** Все формулы из текста (для проверки рендером). */
export function extractMath(src: string): string[] {
  return splitMath(src).filter((s) => s.kind === 'math').map((s) => s.value);
}
