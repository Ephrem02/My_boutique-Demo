import { useTranslation } from 'react-i18next';
import { setLanguage } from '../i18n';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  return (
    <div className="lang-switcher">
      <button
        type="button"
        className={`lang-switcher-btn${i18n.language === 'en' ? ' active' : ''}`}
        onClick={() => setLanguage('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={`lang-switcher-btn${i18n.language === 'rw' ? ' active' : ''}`}
        onClick={() => setLanguage('rw')}
      >
        RW
      </button>
    </div>
  );
}
