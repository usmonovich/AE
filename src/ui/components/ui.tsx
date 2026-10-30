// Базовые элементы интерфейса.

import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { back, navigate, href } from '../router';

export function Link({ to, children, className, ariaLabel }: { to: string; children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <a
      href={href(to)}
      className={className}
      aria-label={ariaLabel}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function Topbar({ title, sub, backTo, actions }: { title: string; sub?: string; backTo?: string | null; actions?: ReactNode }) {
  // Фактическая высота панели (она растёт при крупном системном шрифте и длинном заголовке) —
  // по ней прилипают вкладки и панели ниже (--topbar-h в styles.css).
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header className="topbar" ref={ref}>
      <div className="topbar-in">
        {backTo !== null && backTo !== undefined ? (
          <button className="icon-btn" onClick={() => back(backTo)} aria-label="Назад">
            <Icon name="back" />
          </button>
        ) : (
          <span className="topbar-spacer" />
        )}
        <div className="topbar-title">
          <h1>{title}</h1>
          {sub ? <p>{sub}</p> : null}
        </div>
        <div className="topbar-actions">{actions}</div>
      </div>
    </header>
  );
}

export function Button({
  children, onClick, kind = 'primary', disabled, icon, type = 'button', full, small, id, ariaLabel,
}: {
  children?: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; icon?: string;
  type?: 'button' | 'submit'; full?: boolean; small?: boolean; id?: string; ariaLabel?: string;
}) {
  return (
    <button id={id} type={type} className={`btn btn-${kind}${full ? ' btn-full' : ''}${small ? ' btn-small' : ''}`} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {icon ? <Icon name={icon} size={18} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function Progress({ value, label, tone }: { value: number; label?: string; tone?: 'ok' | 'accent' }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

export function Badge({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'accent' | 'ok' | 'warn' | 'bad'; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ icon = 'page', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children, icon }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; icon?: string }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
      <Icon name={icon ?? (tone === 'ok' ? 'check' : tone === 'info' ? 'bulb' : 'alert')} size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="seg-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id: string }) {
  return (
    <label className="switch-row" htmlFor={id}>
      <span className="switch-text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Модальное окно подтверждения (системные confirm() в опубликованной странице не работают). */
export function Confirm({
  open, title, children, confirmText, cancelText = 'Отмена', danger, onConfirm, onCancel, requireText,
}: {
  open: boolean; title: string; children?: ReactNode; confirmText: string; cancelText?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; requireText?: string;
}) {
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setTyped('');
      setTimeout(() => ref.current?.querySelector<HTMLElement>('input, button')?.focus(), 10);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  const blocked = !!requireText && typed.trim().toUpperCase() !== requireText.toUpperCase();
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{title}</h2>
        {children ? <div className="modal-body">{children}</div> : null}
        {requireText ? (
          <label className="field">
            <span>Введите «{requireText}», чтобы подтвердить</span>
            <input id="confirm-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        ) : null}
        <div className="modal-actions">
          <Button kind="secondary" onClick={onCancel}>{cancelText}</Button>
          <Button kind={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={blocked}>{confirmText}</Button>
        </div>
      </div>
    </div>
  );
}

let toastSet: ((t: string | null) => void) | null = null;
export function toast(text: string) {
  toastSet?.(text);
}
export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setText;
    return () => {
      toastSet = null;
    };
  }, []);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 2600);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <div className="toast-host" aria-live="polite">
      {text ? <div className="toast">{text}</div> : null}
    </div>
  );
}

export function Section({ title, children, aside, id }: { title?: string; children: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <section className="block" id={id}>
      {title ? (
        <div className="block-head">
          <h2>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Скачивание файла в браузере; в опубликованной странице загрузки запрещены — поэтому рядом всегда есть копирование. */
export function tryDownload(name: string, text: string, mime = 'application/json') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* окружение запрещает загрузки */
  }
}
export async function copyText(text: string, fallbackEl?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      fallbackEl.focus();
      fallbackEl.select();
    }
    return false;
  }
}
