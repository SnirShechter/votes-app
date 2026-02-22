import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './auth/AuthProvider';
import { useAuth } from './auth/useAuth';
import { setTokenGetter } from './api';
import { App } from './App';
import './i18n/index';
import './index.css';

function TokenSync() {
  const { token } = useAuth();
  useEffect(() => {
    setTokenGetter(() => token);
  }, [token]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <TokenSync />
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toaster position="bottom-center" />
    </AuthProvider>
  </StrictMode>
);
