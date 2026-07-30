import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DesignPreview } from './design/DesignPreview';
import { ErrorBoundary } from './shared/ErrorBoundary';
import './styles.css';

const isDesignPreview = window.location.pathname === '/design-preview';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      {isDesignPreview ? <DesignPreview /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
