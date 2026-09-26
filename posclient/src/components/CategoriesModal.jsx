import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Tags, Trash2 } from 'lucide-react';
import client from '../api/client';
import Dialog from '../ui/Dialog';
import Button, { IconButton } from '../ui/Button';
import { Input } from '../ui/Field';
import { EmptyState, ErrorState } from '../ui/display';

export default function CategoriesModal({ onClose, onChanged }) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setCategories((await client.get('/categories')).data);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setError(null);
    setLoading(true);
    try {
      await client.post('/categories', { name: name.trim() });
      setName('');
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await client.delete(`/categories/${id}`);
      await load();
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Dialog title={t('categories.title')} size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('common.done')}</Button>}>
      {error && <ErrorState error={error} />}
      {categories && categories.length === 0 && <EmptyState compact icon={Tags} title={t('categories.noCategories')} />}
      {categories && categories.length > 0 && (
        <ul className="simple-list">
          {categories.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <IconButton icon={Trash2} size="sm" label={t('categories.delete', { name: c.name })} onClick={() => handleDelete(c.id)} />
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleAdd} className="inline-form">
        <Input placeholder={t('categories.newCategoryPlaceholder')} aria-label={t('categories.newCategoryPlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" icon={Plus} loading={loading} disabled={!name.trim()}>{t('common.add')}</Button>
      </form>
    </Dialog>
  );
}
