import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

/**
 * Buttons. If onClick returns a promise, the button shows a busy state and
 * ignores further clicks until it settles - so async actions can't be
 * double-submitted. For form submits, pass `loading` from the form's state.
 *
 * variant: primary | secondary | ghost | danger | link
 * size:    sm | md | lg (lg = large touch targets, e.g. POS)
 * `to` renders a router Link styled as a button.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingText,
  icon: Icon,
  iconRight: IconRight,
  block = false,
  to,
  className = '',
  type = 'button',
  onClick,
  disabled,
  children,
  ...rest
}) {
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  const busy = loading || pending;
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, block ? 'btn-block' : '', busy ? 'is-busy' : '', className].filter(Boolean).join(' ');
  const content = (
    <>
      {busy ? <Loader2 className="btn-icon spin" aria-hidden="true" /> : Icon && <Icon className="btn-icon" aria-hidden="true" />}
      {children !== undefined && <span className="btn-label">{busy && loadingText ? loadingText : children}</span>}
      {IconRight && !busy && <IconRight className="btn-icon" aria-hidden="true" />}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  async function handleClick(e) {
    if (busy) {
      e.preventDefault();
      return;
    }
    const result = onClick?.(e);
    if (result && typeof result.then === 'function') {
      setPending(true);
      try {
        await result;
      } finally {
        if (mounted.current) setPending(false);
      }
    }
  }

  return (
    <button type={type} className={classes} onClick={handleClick} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {content}
    </button>
  );
}

/** Icon-only button. `label` is required - it's the accessible name (and tooltip). */
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className = '', badge, ...rest }) {
  return (
    <button type="button" className={`icon-button icon-button-${variant} icon-button-${size} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon aria-hidden="true" />
      {badge}
    </button>
  );
}
