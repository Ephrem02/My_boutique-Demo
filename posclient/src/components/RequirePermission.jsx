import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

// Hides pages the user can't use. Convenience only - the API enforces the
// same permissions, so bypassing this in the browser exposes nothing.
export default function RequirePermission({ anyOf, children }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  if (!hasPermission(...anyOf)) {
    return (
      <div className="page-body">
        <p style={{ color: 'var(--ink-muted)' }}>{t('admin.noAccess')}</p>
      </div>
    );
  }
  return children;
}
