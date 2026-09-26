import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dialog from './Dialog';
import Button from './Button';
import { ErrorState } from './display';

/** "Are you sure?" for irreversible actions. onConfirm may return a promise. */
export default function ConfirmDialog({ title, description, confirmLabel, danger = false, onConfirm, onClose, children }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} description={description} size="sm" onClose={onClose} dismissible={!busy}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy} autoFocus>{t('common.cancel')}</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {error && <ErrorState error={error} />}
      {children}
    </Dialog>
  );
}
