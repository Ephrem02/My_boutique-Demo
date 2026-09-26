import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, XCircle, RotateCw } from 'lucide-react';
import { formatRwf } from './format';
import { describeError } from './errors';
import Button from './Button';

/* ---------------- Status ---------------- */

/**
 * Compact status badge: a dot *and* a text label - status is never shown by
 * colour alone. tone: success | warning | danger | info | neutral | primary
 */
export function StatusBadge({ tone = 'neutral', children, dot = true, className = '' }) {
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' };
export const HEALTH_TONE = { normal: 'success', attention: 'warning', critical: 'danger' };

/* ---------------- Numbers ---------------- */

export function Money({ value, signed = false, className = '' }) {
  return <span className={`num money ${className}`}>{formatRwf(value, { signed })}</span>;
}

/** A labelled figure. size: sm | md | lg | xl (xl = page headline). */
export function Metric({ label, value, hint, tone, size = 'md', className = '', children }) {
  return (
    <div className={`metric metric-${size}${tone ? ` metric-${tone}` : ''} ${className}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value num">{value}</div>
      {hint && <div className="metric-hint">{hint}</div>}
      {children}
    </div>
  );
}

/* ---------------- Layout ---------------- */

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
      {children}
    </div>
  );
}

/** A titled surface. variant: default | muted | outline */
export function Panel({ title, subtitle, actions, icon: Icon, children, variant = 'default', className = '', as: As = 'section', padded = true, ...rest }) {
  return (
    <As className={`panel panel-${variant}${padded ? '' : ' panel-flush'} ${className}`} {...rest}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="panel-heading">
            {Icon && <Icon className="panel-icon" aria-hidden="true" />}
            <div>
              {title && <h2 className="panel-title">{title}</h2>}
              {subtitle && <p className="panel-subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </As>
  );
}

/** Label/value rows, e.g. figures on a board. */
export function DescriptionList({ items, className = '' }) {
  return (
    <dl className={`dl ${className}`}>
      {items.filter(Boolean).map((item) => (
        <div key={item.label} className={`dl-row${item.strong ? ' strong' : ''}`}>
          <dt>{item.label}</dt>
          <dd className={`num${item.tone ? ` text-${item.tone}` : ''}`}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Tabs ---------------- */

/** Accessible tabs (arrow keys move between tabs). Renders the tab list only. */
export function Tabs({ items, value, onChange, label, className = '' }) {
  const refs = useRef([]);
  function onKeyDown(e, index) {
    const delta = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: items.length - 1 - index }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const next = (index + delta + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  }
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label}>
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          type="button"
          aria-selected={item.id === value}
          tabIndex={item.id === value ? 0 : -1}
          className={`tab${item.id === value ? ' active' : ''}`}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {item.label}
          {item.count !== undefined && <span className="tab-count num">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Feedback states ---------------- */

const ALERT_ICON = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: Info };

/** Inline message. tone: info | success | warning | danger */
export function Alert({ tone = 'info', title, children, action, className = '' }) {
  const Icon = ALERT_ICON[tone];
  return (
    <div className={`alert alert-${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className="alert-icon" aria-hidden="true" />
      <div className="alert-content">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-message">{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

/** Friendly error for a failed load or action, with optional retry. */
export function ErrorState({ error, onRetry, action, className = '' }) {
  const { t } = useTranslation();
  if (!error) return null;
  const info = describeError(error, t, { action });
  return (
    <Alert
      tone="danger"
      title={info.title}
      className={className}
      action={onRetry && info.retryable ? <Button size="sm" icon={RotateCw} onClick={onRetry}>{t('common.retry')}</Button> : null}
    >
      {info.message}
    </Alert>
  );
}

export function EmptyState({ icon: Icon, title, description, action, compact = false, className = '' }) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''} ${className}`}>
      {Icon && (
        <div className="empty-state-icon">
          <Icon aria-hidden="true" />
        </div>
      )}
      <div className="empty-state-title">{title}</div>
      {description && <p className="empty-state-description">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 14, radius, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** A panel-shaped loading placeholder (announced once to screen readers). */
export function SkeletonPanel({ lines = 4, className = '' }) {
  const { t } = useTranslation();
  return (
    <div className={`panel skeleton-panel ${className}`} aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton width="40%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - ((i * 13) % 35)}%`} />
      ))}
    </div>
  );
}
