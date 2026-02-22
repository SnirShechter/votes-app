import { Outlet, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { LanguageToggle } from '../i18n/LanguageToggle';

export function Layout() {
  const { t } = useTranslation();
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-blue-600">
            {t('app_title')}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <button
              onClick={() => logout()}
              className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-100"
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
