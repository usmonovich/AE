import { useEffect } from 'react';
import { useRoute } from './router';
import { useSettings } from '../data/store';
import { StartScreen } from './screens/start';
import { Link, ToastHost } from './components/ui';
import { Icon } from './components/Icon';
import { Home, Library, SubsectionScreen, TopicScreen, PageViewer, NotFound } from './screens/learn';
import { TestSetup, TestRun, Results } from './screens/test';
import { Modes, QAPicker, Flashcards, Mistakes, Favorites } from './screens/modes';
import { ProgressScreen } from './screens/progress';
import { SettingsScreen, SearchScreen, Privacy } from './screens/misc';
import { AdminApp } from '../admin/admin';
import { useCloudStatus } from '../data/artifact-cloud';

function useTheme() {
  const { theme, fontScale } = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    root.style.setProperty('--scale', String(fontScale));
  }, [theme, fontScale]);
}

function Screen() {
  const { parts } = useRoute();
  const [a, b, c] = parts;
  switch (a) {
    case undefined: return <Home />;
    case 'library': return <Library />;
    case 'sub': return <SubsectionScreen id={b} />;
    case 'topic': return <TopicScreen id={b} tab={c} />;
    case 'page': return <PageViewer refId={b} />;
    case 'test': return <TestSetup preset={b} id={c} />;
    case 'run': return <TestRun id={b} />;
    case 'result': return <Results id={b} />;
    case 'modes': return <Modes />;
    case 'qa': return <QAPicker />;
    case 'cards': return <Flashcards />;
    case 'mistakes': return <Mistakes />;
    case 'favorites': return <Favorites />;
    case 'progress': return <ProgressScreen />;
    case 'settings': return <SettingsScreen />;
    case 'search': return <SearchScreen />;
    case 'privacy': return <Privacy />;
    case 'admin': return <AdminApp parts={parts} />;
    default: return <NotFound />;
  }
}

const TABS: [string, string, string][] = [
  ['', 'Главная', 'home'], ['library', 'Учебник', 'book'], ['test', 'Тесты', 'test'], ['progress', 'Прогресс', 'chart'], ['settings', 'Ещё', 'gear'],
];

export function App() {
  useTheme();
  const cloud = useCloudStatus();
  const { parts, subject } = useRoute();
  if (cloud.mode === 'connecting') {
    return (
      <div className="app">
        <main id="main" className="screen loading-screen" aria-busy="true">
          <div className="loading-box">
            <span className="spinner" aria-hidden="true" />
            <p>Загружаю сохранённый прогресс и решения проверки…</p>
          </div>
        </main>
      </div>
    );
  }
  if (!subject) {
    return (
      <div className="app">
        <main id="main"><StartScreen /></main>
        <ToastHost />
      </div>
    );
  }
  const focus = parts[0] === 'run';
  const cur = parts[0] ?? '';
  return (
    <div className={`app${focus ? ' focus' : ''}`}>
      <main id="main"><Screen /></main>
      {!focus ? (
        <nav className="tabbar" aria-label="Основная навигация">
          {TABS.map(([to, label, icon]) => (
            <Link key={label} to={to} className={`tab${cur === to || (to === 'test' && ['run', 'result', 'modes', 'cards', 'qa'].includes(cur)) || (to === 'library' && ['sub', 'topic', 'page'].includes(cur)) || (to === 'settings' && ['admin', 'privacy', 'search'].includes(cur)) ? ' on' : ''}`}>
              <Icon name={icon} size={22} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      <ToastHost />
    </div>
  );
}
