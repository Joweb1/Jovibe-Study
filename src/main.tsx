import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {
  attachServiceWorkerAutoRefresh,
  runAutomaticPwaBrandMigration,
} from './utils/pwaMigration.ts';

const migrationStarted = runAutomaticPwaBrandMigration();
attachServiceWorkerAutoRefresh(migrationStarted);

createRoot(document.getElementById('root')!).render(<App />);
