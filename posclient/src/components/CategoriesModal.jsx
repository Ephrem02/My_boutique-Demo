import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../api/client';

export default function CategoriesModal({ onClose, onChanged }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const { data } = await client.get('/categories');
    setCategories(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    setLoading(true);
    try {
      await client.post('/categories', { name: name.trim() });
      setName('');
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await client.delete(`/categories/${id}`);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h2>{t('categories.title')}</h2>
        {error && <div className="error-banner">{error}</div>}

        <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
          {categories.map((c) => (
            <div key={c.id} className="cart-item" style={{ padding: '8px 0' }}>
              <div className="cart-item-info">
                <div className="cart-item-name">{c.name}</div>
              </div>
              <button className="cart-item-remove" onClick={() => handleDelete(c.id)} title={t('common.close')}>
                ×
              </button>
            </div>
          ))}
          {categories.length === 0 && <p style={{ color: 'var(--ink-muted)', fontSize: 14 }}>{t('categories.noCategories')}</p>}
        </div>

        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-strong)' }}
            placeholder={t('categories.newCategoryPlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
            {t('common.add')}
          </button>
        </form>

        <div className="modal-actions">
          <button type="button" className="btn btn-block" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
