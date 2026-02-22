import { useTranslation } from 'react-i18next';
import { updateDirection } from './index';

export function LanguageToggle() {
  const { i18n } = useTranslation();

  const toggle = () => {
    const newLang = i18n.language === 'he' ? 'en' : 'he';
    i18n.changeLanguage(newLang);
    localStorage.setItem('lang', newLang);
    updateDirection(newLang);
  };

  return (
    <button onClick={toggle} className="px-2 py-1 text-sm rounded border border-gray-300 hover:bg-gray-100">
      {i18n.language === 'he' ? 'English' : 'עברית'}
    </button>
  );
}
