import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { IconButton } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let openCount = 0;

/**
 * Accessible modal dialog: focus moves in and is trapped, Escape closes,
 * focus returns to the opener, the page behind can't scroll, and screen
 * readers get role="dialog" + aria-modal + a label. On phones it becomes a
 * bottom sheet.
 *
 * Pass onSubmit to render the panel as a <form> (footer submit buttons then
 * just work). size: sm | md | lg. variant: 'dialog' | 'drawer' (side panel).
 */
export default function Dialog({
  title,
  description,
  onClose,
  onSubmit,
  footer,
  size = 'md',
  variant = 'dialog',
  dismissible = true,
  hideTitle = false,
  children,
  className = '',
}) {
  const { t } = useTranslation();
  const panelRef = useRef(null);
  // Capture the opener during the first render - before children commit,
  // because a child's autoFocus moves focus into the dialog before effects run.
  const openerRef = useRef(null);
  if (openerRef.current === null) openerRef.current = document.activeElement || document.body;
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const opener = openerRef.current;
    openCount += 1;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    // Respect a child's autoFocus; otherwise focus the first control in the body
    if (!panel.contains(document.activeElement)) {
      const inBody = FOCUSABLE.split(',').map((s) => `.dialog-body ${s.trim()}`).join(', ');
      const first = panel.querySelector(inBody) || panel.querySelector(FOCUSABLE);
      (first || panel).focus();
    }
    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = '';
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const Panel = onSubmit ? 'form' : 'div';
  return createPortal(
    <div className={`dialog-root dialog-root-${variant}`} onKeyDown={onKeyDown}>
      <div className="dialog-overlay" onMouseDown={() => dismissible && onClose?.()} aria-hidden="true" />
      <Panel
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`dialog dialog-${size} dialog-${variant} ${className}`}
        tabIndex={-1}
        onSubmit={onSubmit ? (e) => { e.preventDefault(); onSubmit(e); } : undefined}
        noValidate={onSubmit ? false : undefined}
      >
        <header className="dialog-header">
          <div className="dialog-heading">
            <h2 id={titleId} className={hideTitle ? 'sr-only' : 'dialog-title'}>{title}</h2>
            {description && <p id={descId} className="dialog-description">{description}</p>}
          </div>
          {dismissible && <IconButton icon={X} label={t('common.close')} onClick={onClose} className="dialog-close" />}
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </Panel>
    </div>,
    document.body
  );
}
