import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { startCloud } from './data/artifact-cloud';
import 'katex/dist/katex.min.css';
import './styles.css';

// В артефакте claude.ai данные хранятся в его базе; запускаем загрузку до первого кадра.
void startCloud();

const el = document.getElementById('root')!;
createRoot(el).render(<App />);
