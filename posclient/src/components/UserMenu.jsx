import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import LanguageSwitcher from './LanguageSwitcher';

const APPEARANCE = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Monitor },
];

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

/** Header account menu: who's signed in, appearance, language, settings, sign out. */
export default function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    await logout();
    navigate('/login');
  }

  const roleLabel = t(`roles.${user?.role}`, { defaultValue: user?.role });
  return (
    <div className="popover-anchor" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="user-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('shell.accountMenu', { name: user?.full_name })}
      >
        <span className="avatar" aria-hidden="true">{initials(user?.full_name)}</span>
        <span className="user-button-text">
          <span className="user-button-name">{user?.full_name}</span>
          <span className="user-button-role">{roleLabel}</span>
        </span>
        <ChevronDown className="user-button-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="popover popover-right user-menu">
          <div className="user-menu-header">
            <span className="avatar avatar-lg" aria-hidden="true">{initials(user?.full_name)}</span>
            <div>
              <div className="user-menu-name">{user?.full_name}</div>
              <div className="user-menu-role">{roleLabel}</div>
            </div>
          </div>

          <div className="user-menu-section">
            <div className="user-menu-label" id="appearance-label">{t('settings.appearance')}</div>
            <div className="segmented segmented-block" role="group" aria-labelledby="appearance-label">
              {APPEARANCE.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented-option${preference === value ? ' active' : ''}`}
                  aria-pressed={preference === value}
                  onClick={() => setPreference(value)}
                >
                  <Icon aria-hidden="true" />
                  {t(`settings.appearanceOptions.${value}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="user-menu-section">
            <div className="user-menu-label">{t('settings.language')}</div>
            <LanguageSwitcher className="segmented-block" />
          </div>

          <div className="user-menu-links">
            <Link to="/settings" className="menu-item" onClick={() => setOpen(false)}>
              <Settings aria-hidden="true" />
              {t('shell.settings')}
            </Link>
            <button type="button" className="menu-item" onClick={signOut}>
              <LogOut aria-hidden="true" />
              {t('nav.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
