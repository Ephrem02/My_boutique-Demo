import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ChevronsUpDown, ChevronLeft, ChevronRight, Search, Inbox } from 'lucide-react';
import useBreakpoint from './useBreakpoint';
import { EmptyState, ErrorState, Skeleton } from './display';

/**
 * One table definition, two presentations:
 *  - tablet/desktop: a real <table> with sticky header, sorting, search and
 *    pagination
 *  - mobile: a list of cards (title, value, subtitle, badges, details) -
 *    never a squeezed 7-column table
 *
 * columns: [{
 *   key, header, render?(row), align?: 'right',
 *   sortable?, sortValue?(row),
 *   mobile?: 'title' | 'value' | 'subtitle' | 'meta' | 'detail' (default) | 'hide',
 *   searchValue?(row)
 * }]
 * Rows are clickable when onRowClick is given (keyboard: Enter/Space).
 */
export default function DataTable({
  columns,
  rows,
  rowKey = 'id',
  onRowClick,
  rowLabel,
  loading = false,
  error,
  onRetry,
  errorAction,
  empty,
  searchable = false,
  searchPlaceholder,
  initialSort,
  pageSize = 25,
  caption,
  toolbar,
  className = '',
}) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort || null); // { key, dir: 'asc'|'desc' }
  const [page, setPage] = useState(1);

  const keyOf = (row) => (typeof rowKey === 'function' ? rowKey(row) : row[rowKey]);

  const filtered = useMemo(() => {
    const list = rows || [];
    if (!searchable || !query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((row) =>
      columns.some((c) => {
        const v = c.searchValue ? c.searchValue(row) : row[c.key];
        return v !== null && v !== undefined && String(v).toLowerCase().includes(q);
      })
    );
  }, [rows, query, searchable, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const value = col.sortValue || ((row) => row[col.key]);
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(key) {
    setPage(1);
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  }

  function rowProps(row) {
    if (!onRowClick) return {};
    return {
      className: 'clickable',
      tabIndex: 0,
      onClick: () => onRowClick(row),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick(row);
        }
      },
      'aria-label': rowLabel ? rowLabel(row) : undefined,
    };
  }

  const cell = (col, row) => (col.render ? col.render(row) : row[col.key] ?? '—');

  const search = searchable && (
    <label className="table-search">
      <Search aria-hidden="true" />
      <span className="sr-only">{searchPlaceholder || t('common.search')}</span>
      <input
        type="search"
        className="input"
        value={query}
        placeholder={searchPlaceholder || t('common.search')}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
    </label>
  );

  let body;
  if (error) {
    body = <ErrorState error={error} onRetry={onRetry} action={errorAction} />;
  } else if (loading && !rows?.length) {
    body = (
      <div className="table-skeleton" aria-busy="true">
        <span className="sr-only">{t('common.loading')}</span>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={isMobile ? 56 : 20} />)}
      </div>
    );
  } else if (!sorted.length) {
    body = query ? (
      <EmptyState compact icon={Search} title={t('common.noMatches')} description={t('common.noMatchesHint', { query })} />
    ) : (
      <EmptyState compact icon={empty?.icon || Inbox} title={empty?.title || t('common.nothingHere')} description={empty?.description} action={empty?.action} />
    );
  } else if (isMobile) {
    const titleCol = columns.find((c) => c.mobile === 'title') || columns[0];
    const valueCol = columns.find((c) => c.mobile === 'value');
    const subtitleCols = columns.filter((c) => c.mobile === 'subtitle');
    const metaCols = columns.filter((c) => c.mobile === 'meta');
    const detailCols = columns.filter((c) => c !== titleCol && c !== valueCol && (!c.mobile || c.mobile === 'detail'));
    body = (
      <ul className="card-list" aria-label={caption}>
        {visible.map((row) => {
          const Tag = onRowClick ? 'button' : 'div';
          return (
            <li key={keyOf(row)}>
              <Tag
                type={onRowClick ? 'button' : undefined}
                className={`list-card${onRowClick ? ' clickable' : ''}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
              >
                <span className="list-card-top">
                  <span className="list-card-title">{cell(titleCol, row)}</span>
                  {valueCol && <span className="list-card-value num">{cell(valueCol, row)}</span>}
                </span>
                {subtitleCols.map((c) => <span key={c.key} className="list-card-subtitle">{cell(c, row)}</span>)}
                {metaCols.length > 0 && <span className="list-card-meta">{metaCols.map((c) => <span key={c.key}>{cell(c, row)}</span>)}</span>}
                {detailCols.length > 0 && (
                  <span className="list-card-details">
                    {detailCols.map((c) => (
                      <span key={c.key} className="list-card-detail">
                        <span className="list-card-detail-label">{c.header}</span>
                        <span className="num">{cell(c, row)}</span>
                      </span>
                    ))}
                  </span>
                )}
              </Tag>
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="table-wrap">
        <table className="table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.filter((c) => c.header !== undefined).map((col) => {
                const active = sort?.key === col.key;
                const SortIcon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.align === 'right' ? 'align-right' : ''}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sortable ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(col.key)}>
                        {col.header}
                        <SortIcon className="th-sort-icon" aria-hidden="true" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={keyOf(row)} {...rowProps(row)}>
                {columns.filter((c) => c.header !== undefined).map((col) => (
                  <td key={col.key} className={`${col.align === 'right' ? 'align-right num' : ''}${col.className ? ` ${col.className}` : ''}`}>
                    {cell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`data-table ${className}`}>
      {(search || toolbar) && (
        <div className="table-toolbar">
          {search}
          {toolbar}
        </div>
      )}
      {body}
      {pages > 1 && !error && (
        <nav className="pagination" aria-label={t('common.pagination')}>
          <span className="pagination-info num">
            {t('common.rangeOf', { from: (currentPage - 1) * pageSize + 1, to: Math.min(currentPage * pageSize, sorted.length), total: sorted.length })}
          </span>
          <div className="pagination-buttons">
            <button type="button" className="icon-button icon-button-secondary" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} aria-label={t('common.previous')}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <button type="button" className="icon-button icon-button-secondary" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pages} aria-label={t('common.next')}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
