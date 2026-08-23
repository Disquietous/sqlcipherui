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

export function DFText({ value, onChange, placeholder, mono }) {
  return <input className={cx('df-input', mono && 'mono')} value={value ?? ''} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} />;
}

export function DFTextarea({ value, onChange, placeholder, mono = true }) {
  return <textarea className={cx('df-input df-textarea', mono && 'mono')} value={value ?? ''} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} rows={3} />;
}

export function DFNumber({ value, onChange }) {
  return <input className="df-input mono" type="number" value={value ?? ''} onChange={e => onChange?.(Number(e.target.value))} style={{ width: 100 }} />;
}

export function DFSelect({ value, options, onChange, compact }) {
  return (
    <select className={cx('df-input', compact && 'df-input-compact')} value={value ?? ''} onChange={e => onChange?.(e.target.value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function DFRadio({ value, options, onChange }) {
  return (
    <div className="df-radio">
      {options.map(o => (
        <button key={o.v} className={cx('df-radio-btn', value === o.v && 'is-on')} onClick={() => onChange?.(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}
