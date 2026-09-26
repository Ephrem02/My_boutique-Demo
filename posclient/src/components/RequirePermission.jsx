import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { EmptyState } from '../ui/display';
import Button from '../ui/Button';

// Hides pages the user can't use. Convenience only - the API enforces the
// same permissions, so bypassing this in the browser exposes nothing.
export default function RequirePermission({ anyOf, children }) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  if (!hasPermission(...anyOf)) {
    return (
      <div className="page">
        <EmptyState icon={Lock} title={t('admin.noAccess')} description={t('admin.noAccessHint')} action={<Button to="/">{t('nav.items.dashboard')}</Button>} />
      </div>
    );
  }
  return children;
}
