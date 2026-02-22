import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './useAuth';
import { LoadingSpinner } from '../components/LoadingSpinner';

export function CallbackPage() {
  const { handleCallback } = useAuth();
  const navigate = useNavigate();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    handleCallback()
      .then(() => {
        const returnTo = sessionStorage.getItem('auth_return_to') || '/';
        sessionStorage.removeItem('auth_return_to');
        navigate(returnTo, { replace: true });
      })
      .catch((err) => {
        console.error('OIDC callback error:', err);
        navigate('/', { replace: true });
      });
  }, []);

  return <LoadingSpinner />;
}
