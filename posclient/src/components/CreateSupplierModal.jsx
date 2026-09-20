import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function CreateSupplierModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    contact_phone: '',
    contact_email: '',
    address: '',
    payment_terms: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await client.post('/suppliers', form);
      onCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h2>{t('suppliers.newSupplierTitle')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="name">{t('common.name')}</label>
          <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="phone">{t('suppliers.contactPhone')}</label>
          <input id="phone" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="email">{t('suppliers.contactEmail')}</label>
          <input
            id="email"
            type="email"
            value={form.contact_email}
            onChange={(e) => update('contact_email', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="address">{t('suppliers.address')}</label>
          <input id="address" value={form.address} onChange={(e) => update('address', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="terms">{t('common.paymentTerms')}</label>
          <input
            id="terms"
            placeholder={t('suppliers.paymentTermsPlaceholder')}
            value={form.payment_terms}
            onChange={(e) => update('payment_terms', e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? t('common.saving') : t('suppliers.addSupplier')}
          </button>
        </div>
      </form>
    </div>
  );
}
