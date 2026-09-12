import { useEffect, useId, useRef } from 'react';
import { Icon } from '../icons/Icon';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFField({ label, hint, children }) {
  return (
    <div className="df-field">
      <div className="df-field-label">{label}</div>
      {children}
      {hint && <div className="df-field-hint muted small">{hint}</div>}
    </div>
  );
}

export function DFText({ value, onChange, placeholder, mono, type = 'text', list, ariaLabel, autoFocus, onKeyDown }) {
  return (
    <input
      className={cx('df-input', mono && 'mono')}
      type={type}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      list={list}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      autoComplete={type === 'password' ? 'off' : undefined}
    />
  );
}

export function DFPassword(props) {
  return <DFText {...props} type="password" mono />;
}

export function DFTextarea({ value, onChange, placeholder, mono = true, rows = 3, ariaLabel }) {
  return (
    <textarea
      className={cx('df-input df-textarea', mono && 'mono')}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      aria-label={ariaLabel}
    />
  );
}

export function DFNumber({ value, onChange, min, ariaLabel }) {
  return (
    <input
      className="df-input mono"
      type="number"
      min={min}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value === '' ? null : Number(e.target.value))}
      style={{ width: 110 }}
      aria-label={ariaLabel}
    />
  );
}

/** `options` may be strings or `{v, l}` objects. */
export function DFSelect({ value, options, onChange, compact, ariaLabel }) {
  return (
    <select
      className={cx('df-input', compact && 'df-input-compact')}
      value={value ?? ''}
      onChange={e => onChange?.(e.target.value)}
      aria-label={ariaLabel}
    >
      {options.map(o => {
        const v = typeof o === 'string' ? o : o.v;
        const l = typeof o === 'string' ? o : o.l;
        return <option key={v} value={v}>{l}</option>;
      })}
    </select>
  );
}

export function DFRadio({ value, options, onChange, ariaLabel }) {
  return (
    <div className="df-radio" role="radiogroup" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          className={cx('df-radio-btn', value === o.v && 'is-on')}
          aria-pressed={value === o.v}
          onClick={() => onChange?.(o.v)}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function DFCheckbox({ checked, onChange, label, hint }) {
  const id = useId();
  return (
    <div className="df-check">
      <input id={id} type="checkbox" checked={!!checked} onChange={e => onChange?.(e.target.checked)} />
      <label htmlFor={id}>
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </label>
    </div>
  );
}

/**
 * Accessible modal shell: role=dialog, aria-modal, labelled by the title,
 * Escape closes, focus moves into the dialog on open, backdrop click closes.
 */
export function DFModal({ title, icon, onClose, width = 480, children, headActions, flush = false, className }) {
  const titleId = useId();
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement;
    const first = el.querySelector('[data-autofocus], input, select, textarea, button:not([data-close])');
    (first || el).focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={ref}
        className={cx('modal df-modal', flush && 'df-modal-flush', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width, textAlign: 'left', padding: 0 }}
      >
        <div className="df-mod-head">
          {icon}
          <h3 id={titleId} className="modal-title" style={{ margin: 0 }}>{title}</h3>
          <div style={{ flex: 1 }}></div>
          {headActions}
          <button type="button" className="iconbtn-sm" data-close onClick={onClose} aria-label="Close dialog" title="Close">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className={cx('df-mod-body', flush && 'is-flush')}>{children}</div>
      </div>
    </div>
  );
}
