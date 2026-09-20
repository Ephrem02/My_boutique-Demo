import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

const CLIENT_TYPES = ['shop', 'school', 'individual', 'company', 'other'];

export default function CreateInstitutionModal({ onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    type: 'shop',
    contact_person: '',
    contact_phone: '',
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
      const { data } = await client.post('/institutions', form);
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
        <h2>{t('institutions.newInstitutionTitle')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label htmlFor="name">{t('common.name')}</label>
          <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="type">{t('institutions.type')}</label>
          <select id="type" value={form.type} onChange={(e) => update('type', e.target.value)}>
            {CLIENT_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`institutions.types.${ct}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="contact_person">{t('institutions.contactPerson')}</label>
          <input id="contact_person" value={form.contact_person} onChange={(e) => update('contact_person', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="phone">{t('suppliers.contactPhone')}</label>
          <input id="phone" value={form.contact_phone} onChange={(e) => update('contact_phone', e.target.value)} />
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
            {loading ? t('common.saving') : t('institutions.addInstitution')}
          </button>
        </div>
      </form>
    </div>
  );
}
