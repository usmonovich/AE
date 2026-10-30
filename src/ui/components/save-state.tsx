// Строка «где и когда сохранено» — чтобы было видно, что решения и прогресс не пропадут.

import { useCloudStatus } from '../../data/artifact-cloud';
import { kv } from '../../data/storage';

const hhmm = (t?: number) => (t ? new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

export function SaveState({ scope }: { scope: 'admin' | 'user' }) {
  const s = useCloudStatus();
  let tone: 'ok' | 'busy' | 'warn' | '' = '';
  let text: string;
  if (s.mode === 'cloud') {
    const writable = scope === 'admin' ? s.adminWritable : s.userSaved;
    if (!writable) {
      tone = 'warn';
      text = scope === 'admin'
        ? 'Решения проверки может сохранять только владелец артефакта — ваши изменения останутся только на этом устройстве.'
        : 'Прогресс не сохраняется в базе артефакта (нужен вход в claude.ai).';
    } else if (s.pending) {
      tone = 'busy';
      text = 'Сохраняю…';
    } else if (s.error) {
      tone = 'warn';
      text = s.error;
    } else {
      tone = 'ok';
      text = `${scope === 'admin' ? 'Решения проверки' : 'Прогресс'} сохранены в базе артефакта${s.savedAt ? ` · ${hhmm(s.savedAt)}` : ''} — откроются на любом устройстве.`;
    }
  } else if (s.error) {
    tone = 'warn';
    text = s.error;
  } else {
    tone = kv.persistent ? '' : 'warn';
    text = kv.persistent ? 'Сохраняется на этом устройстве.' : 'Это окно не сохраняет данные — после закрытия они пропадут.';
  }
  return (
    <p className={`save-state ${tone}`} role="status" aria-live="polite" id={`save-state-${scope}`}>
      <span className="dot" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
