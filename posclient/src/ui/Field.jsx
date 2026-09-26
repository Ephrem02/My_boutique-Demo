import { createContext, useContext, useId } from 'react';

// Field wires label, hint and error to its control automatically: the
// control gets the id, aria-describedby and aria-invalid from context.
const FieldContext = createContext(null);

export function Field({ label, hint, error, required = false, children, className = '', id: idProp, inline = false }) {
  const autoId = useId();
  const id = idProp || autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error, required }}>
      <div className={`field${inline ? ' field-inline' : ''}${error ? ' has-error' : ''} ${className}`}>
        {label && (
          <label htmlFor={id} className="field-label">
            {label}
            {required && <span className="field-required" aria-hidden="true"> *</span>}
          </label>
        )}
        {children}
        {hint && !error && <p id={hintId} className="field-hint">{hint}</p>}
        {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps(props) {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  return {
    id: ctx.id,
    'aria-describedby': ctx.describedBy,
    'aria-invalid': ctx.invalid || undefined,
    required: ctx.required || undefined,
    ...props,
  };
}

export function Input({ className = '', ...props }) {
  return <input className={`input ${className}`} {...useFieldProps(props)} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`input select ${className}`} {...useFieldProps(props)}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', rows = 3, ...props }) {
  return <textarea className={`input textarea ${className}`} rows={rows} {...useFieldProps(props)} />;
}

/** Checkbox / switch with its own label (not inside Field). */
export function Checkbox({ label, description, className = '', ...props }) {
  const id = useId();
  return (
    <div className={`checkbox ${className}`}>
      <input type="checkbox" id={id} {...props} />
      <label htmlFor={id}>
        <span className="checkbox-label">{label}</span>
        {description && <span className="checkbox-description">{description}</span>}
      </label>
    </div>
  );
}

/** Radio cards, e.g. Appearance: Light / Dark / System. */
export function RadioCards({ name, options, value, onChange, label }) {
  return (
    <fieldset className="radio-cards">
      {label && <legend className="field-label">{label}</legend>}
      <div className="radio-cards-grid">
        {options.map((opt) => {
          const Icon = opt.icon;
          const checked = value === opt.value;
          return (
            <label key={opt.value} className={`radio-card${checked ? ' checked' : ''}`}>
              <input type="radio" name={name} value={opt.value} checked={checked} onChange={() => onChange(opt.value)} />
              {Icon && <Icon className="radio-card-icon" aria-hidden="true" />}
              <span className="radio-card-label">{opt.label}</span>
              {opt.description && <span className="radio-card-description">{opt.description}</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
