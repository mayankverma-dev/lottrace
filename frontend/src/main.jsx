import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { ErrorFallback } from './components/common/ErrorFallback';
import { initErrorReporting } from './lib/errorReporter';

const root = createRoot(document.getElementById('root'));

initErrorReporting().finally(() => {
  root.render(
    <StrictMode>
      <ErrorBoundary
        fallback={(
          <ErrorFallback
            fullScreen
            onReload={() => window.location.reload()}
            onGoHome={() => window.location.assign('/dashboard')}
          />
        )}
      >
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
