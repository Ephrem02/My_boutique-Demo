import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { History, NotebookPen } from 'lucide-react';
import client from '../../api/client';
import DataTable from '../../ui/DataTable';
import Button from '../../ui/Button';
import { Field, Input, Textarea } from '../../ui/Field';
import { EmptyState, ErrorState, Panel, SkeletonPanel, StatusBadge } from '../../ui/display';
import { formatRwf, formatDate, formatDateTime } from '../../ui/format';
import { useToast } from '../../ui/Toast';
import { financeUrl } from '../parties';

const localDate = (v) => {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = () => localDate(Date.now());

/* ---------------- Documents & notes: identity note + follow-up log ---------------- */

export function NotesTab({ kind, party, canWrite }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState(null);
  const [body, setBody] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(financeUrl(kind, `/parties/${party.id}/notes`));
      setNotes(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [kind, party.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await client.post(financeUrl(kind, `/parties/${party.id}/notes`), { body, follow_up_date: followUp || undefined });
      setBody('');
      setFollowUp('');
      toast.success(t('profile.noteAdded'));
      load();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {party.notes && (
        <Panel title={t('profile.notesField')} variant="muted" className="profile-section">
          <p className="profile-note-body">{party.notes}</p>
        </Panel>
      )}
      {canWrite && (
        <Panel title={t('profile.addNote')} subtitle={t('profile.addNoteHint')} className="profile-section">
          <form onSubmit={add}>
            {saveError && <ErrorState error={saveError} />}
            <Field label={t('profile.note')} required>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} required />
            </Field>
            <div className="form-row">
              <Field label={t('profile.followUpDate')} hint={t('profile.followUpHint')}>
                <Input type="date" value={followUp} min={today()} onChange={(e) => setFollowUp(e.target.value)} />
              </Field>
            </div>
            <Button type="submit" variant="primary" icon={NotebookPen} loading={saving} loadingText={t('common.saving')} disabled={!body.trim()}>{t('profile.saveNote')}</Button>
          </form>
        </Panel>
      )}
      {error && <ErrorState error={error} onRetry={load} />}
      {!notes && !error && <SkeletonPanel lines={4} />}
      {notes && notes.length === 0 && <EmptyState compact icon={NotebookPen} title={t('profile.noNotes')} description={t('profile.noNotesHint')} />}
      {notes && notes.length > 0 && (
        <ul className="record-list">
          {notes.map((n) => {
            const due = n.follow_up_date && localDate(n.follow_up_date) <= today();
            return (
              <li key={n.id} className="record-card">
                <div className="record-card-top">
                  <span className="record-card-title">{n.created_by_name} · {formatDateTime(n.created_at)}</span>
                  {n.follow_up_date && (
                    <StatusBadge tone={due ? 'warning' : 'info'}>
                      {t('profile.followUpOn', { date: formatDate(n.follow_up_date) })}
                    </StatusBadge>
                  )}
                </div>
                <p className="profile-note-body">{n.body}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="field-hint profile-section">{t('profile.notesAppendOnly')}</p>
    </>
  );
}

/* ---------------- Activity & audit ---------------- */

const FIELD_SKIP = new Set(['updated_at', 'created_at']);

function describe(t, row) {
  const n = row.new_values || {};
  const o = row.old_values || {};
  if (n.amount !== undefined && n.method) return `${formatRwf(n.amount)} · ${t(`paymentMethods.${n.method}`, { defaultValue: n.method })}${n.reference_no ? ` · ${n.reference_no}` : ''}`;
  if (n.amount !== undefined) return formatRwf(n.amount);
  if (n.body) return n.body;
  if (row.action.endsWith('.update') && Object.keys(n).length) {
    return Object.keys(n).filter((k) => !FIELD_SKIP.has(k)).map((k) => `${k}: ${o[k] ?? '—'} → ${n[k] ?? '—'}`).join('; ');
  }
  if (n.reason) return n.reason;
  if (n.total_amount !== undefined) return formatRwf(n.total_amount);
  if (n.decision) return n.decision;
  return '';
}

export function ActivityTab({ kind, party, onOpen }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(financeUrl(kind, `/parties/${party.id}/activity`));
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [kind, party.id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Panel title={t('profile.tabs.activity')} subtitle={t('profile.activityHint')} padded={false}>
      <DataTable
        caption={t('profile.tabs.activity')}
        columns={[
          { key: 'created_at', header: t('profile.when'), mobile: 'subtitle', render: (r) => formatDateTime(r.created_at) },
          {
            key: 'action', header: t('profile.what'), mobile: 'title',
            render: (r) => (
              <>
                {t(`profile.actions.${r.action.replace(/\./g, '_')}`, { defaultValue: r.action })}
                {r.invoice_id && <> · <button type="button" className="link-button" onClick={() => onOpen(r.invoice_id)}>#{r.invoice_id}</button></>}
              </>
            ),
            searchValue: (r) => `${t(`profile.actions.${r.action.replace(/\./g, '_')}`, { defaultValue: r.action })} ${r.action} #${r.invoice_id || ''}`,
          },
          { key: 'actor_name', header: t('profile.who'), mobile: 'meta', render: (r) => r.actor_name || t('profile.system') },
          { key: 'details', header: t('profile.details'), render: (r) => <span className="text-secondary">{describe(t, r) || '—'}</span>, searchValue: (r) => describe(t, r) },
        ]}
        rows={rows}
        loading={!rows}
        error={error}
        onRetry={load}
        searchable
        searchPlaceholder={t('profile.searchActivity')}
        empty={{ icon: History, title: t('profile.noActivity') }}
      />
    </Panel>
  );
}
