// Короткая подпись страницы-источника для интерфейса.
// Ссылка на страницу — буква-префикс файла и номер: «a05», «a12L» (L/R — левая и правая страница разворота),
// у учебника — «b157» (печатная страница). Подпись — номер с необязательной меткой файла: у файла-источника
// можно задать pageLabel в 00-structure.yaml (например, «лк» → «лк5»), без неё показывается только номер.
// Метки берутся из учебной базы активного предмета (setPageLabels вызывает хранилище при смене предмета).

let labels: Record<string, string> = {};
let refRe: RegExp | null = null;

/** Метки файлов активного предмета: буква-префикс → подпись. */
export function setPageLabels(sourceFiles: { pagePrefix?: string; pageLabel?: string }[]) {
  labels = {};
  for (const f of sourceFiles) if (f.pagePrefix) labels[f.pagePrefix] = f.pageLabel ?? '';
  const letters = Object.keys(labels).join('');
  refRe = letters ? new RegExp(`\\b([${letters}])(\\d{2,3})([LR]?)\\b`, 'g') : null;
}

export function pageLabel(ref: string): string {
  const m = /^([a-z])(\d+)([LR]?)$/.exec(ref);
  if (!m) return ref;
  return `${labels[m[1]] ?? ''}${Number(m[2])}${m[3]}`;
}

/** Заменяет в обычном тексте ссылки вида «стр. a03», «a10–a11» на подписи интерфейса,
 *  чтобы подсказки и пояснения совпадали с подписями источников. */
export function labelPageRefs(text: string): string {
  return refRe ? text.replace(refRe, (ref) => pageLabel(ref)) : text;
}
