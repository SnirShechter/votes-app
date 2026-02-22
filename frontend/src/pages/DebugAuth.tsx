import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';

export function DebugAuth() {
  const { token, isAuthenticated, user } = useAuth();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/auth/debug', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [token]);

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>
      <h2>Auth Debug</h2>
      <p><b>isAuthenticated:</b> {String(isAuthenticated)}</p>
      <p><b>hasToken:</b> {String(!!token)}</p>
      <p><b>tokenPrefix:</b> {token ? token.substring(0, 20) + '...' : 'none'}</p>
      <p><b>user.expired:</b> {String(user?.expired)}</p>
      <p><b>user.expires_at:</b> {user?.expires_at ? new Date(user.expires_at * 1000).toISOString() : 'n/a'}</p>
      <hr />
      <h3>Backend /api/auth/debug response:</h3>
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}
      <pre>{result ? JSON.stringify(result, null, 2) : 'Loading...'}</pre>
    </div>
  );
}
