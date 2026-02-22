import { useLocation } from 'react-router';
import { useAuth } from './useAuth';
import { LoadingSpinner } from '../components/LoadingSpinner';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    login(location.pathname + location.search);
    return <LoadingSpinner />;
  }

  return <>{children}</>;
}
