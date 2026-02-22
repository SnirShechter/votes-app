import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  handleCallback: () => Promise<User | null>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

const userManager = new UserManager({
  authority: import.meta.env.VITE_OIDC_ISSUER ||
    'https://auth.snir.sh/application/o/votes/',
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID ||
    'jPNKPrV3uouhNtJTyz8BzkTPSkSZ1xoTIZ81cK50',
  redirect_uri: `${window.location.origin}/callback`,
  post_logout_redirect_uri: window.location.origin,
  response_type: 'code',
  scope: 'openid profile email',
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    userManager.getUser().then((u) => {
      if (u && !u.expired) {
        setUser(u);
      }
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });

    userManager.events.addUserLoaded((u) => setUser(u));
    userManager.events.addUserUnloaded(() => setUser(null));
    userManager.events.addSilentRenewError(() => setUser(null));
  }, []);

  const login = useCallback(async (returnTo?: string) => {
    if (returnTo) {
      sessionStorage.setItem('auth_return_to', returnTo);
    }
    await userManager.signinRedirect();
  }, []);

  const logout = useCallback(async () => {
    await userManager.signoutRedirect();
  }, []);

  const handleCallback = useCallback(async () => {
    const u = await userManager.signinRedirectCallback();
    setUser(u);
    return u;
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user && !user.expired,
      isLoading,
      token: user?.access_token || null,
      login,
      logout,
      handleCallback,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
