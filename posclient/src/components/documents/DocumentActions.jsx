import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Printer } from 'lucide-react';
import client from '../../api/client';
import Button from '../../ui/Button';
import { useToast } from '../../ui/Toast';

async function fetchPdf(path, params) {
  const { data } = await client.get(path, { params: { ...params, format: 'pdf' }, responseType: 'blob' });
  return new Blob([data], { type: 'application/pdf' }); // sent as plain bytes (see backend documentRoutes.js)
}

/**
 * Preview & print / Download PDF for a server-generated document. The PDF is
 * built on the server from stored records; the browser's PDF viewer does the
 * printing (page numbers, repeating headers). Every download is audited.
 *
 * path: API path, e.g. `/documents/daily/12`; params: filters (from, to...).
 */
export default function DocumentActions({ path, params = {}, filename, size = 'md', printLabel, className = '' }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(null);

  async function preview() {
    // Open the tab now (inside the click) so pop-up blockers allow it, then fill it
    const win = window.open('', '_blank');
    setBusy('preview');
    try {
      const blob = await fetchPdf(path, params);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      win?.close();
      toast.error(err.status === 403 ? t('documents.notAllowed') : t('documents.failed'));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('download');
    try {
      const blob = await fetchPdf(path, params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err.status === 403 ? t('documents.notAllowed') : t('documents.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className={`document-actions ${className}`}>
      <Button size={size} icon={Printer} loading={busy === 'preview'} disabled={!!busy} onClick={preview}>{printLabel || t('documents.previewPrint')}</Button>
      <Button size={size} icon={Download} loading={busy === 'download'} disabled={!!busy} onClick={download}>{t('documents.downloadPdf')}</Button>
    </span>
  );
}
