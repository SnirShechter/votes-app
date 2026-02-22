import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './he.json';
import en from './en.json';

const savedLang = localStorage.getItem('lang') || 'he';

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export function updateDirection(lang: string) {
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
}

updateDirection(savedLang);

export default i18n;
