import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';

const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'rw', label: 'RW', name: 'Kinyarwanda' },
];

/** Compact EN / RW segmented control. */
export default function LanguageSwitcher({ className = '' }) {
  const { i18n, t } = useTranslation();
  return (
    <div className={`segmented ${className}`} role="group" aria-label={t('settings.language')}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          type="button"
          className={`segmented-option${i18n.language === lang.code ? ' active' : ''}`}
          aria-pressed={i18n.language === lang.code}
          onClick={() => setLanguage(lang.code)}
          title={lang.name}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
