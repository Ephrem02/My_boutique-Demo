import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import rw from './locales/rw';

const stored = (() => {
  try {
    return localStorage.getItem('language');
  } catch {
    return null;
  }
})();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    rw: { translation: rw },
  },
  lng: stored === 'rw' ? 'rw' : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang) {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem('language', lang);
  } catch {
    // ignore - browsers that block storage just won't persist the choice
  }
}

export default i18n;
