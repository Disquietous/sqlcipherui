export function Icon({ name, size = 16, stroke = 1.6, style }) {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round',
    strokeLinejoin: 'round', style,
  };
  switch (name) {
    case 'table': return (
      <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/></svg>
    );
    case 'view': return (
      <svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
    );
    case 'index': return (
      <svg {...props}><path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="1.5"/><circle cx="16" cy="18" r="1.5"/></svg>
    );
    case 'trigger': return (
      <svg {...props}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>
    );
    case 'database': return (
      <svg {...props}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/></svg>
    );
    case 'lock': return (
      <svg {...props}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    );
    case 'unlock': return (
      <svg {...props}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>
    );
    case 'key': return (
      <svg {...props}><circle cx="7.5" cy="15.5" r="3.5"/><path d="m10 13 9-9 2 2-3 3 2 2-3 3-2-2"/></svg>
    );
    case 'pin': return (
      <svg {...props}><path d="M12 3v7l3 3v3H9v-3l3-3M12 16v5"/></svg>
    );
    case 'play': return (
      <svg {...props}><path d="M6 4l14 8-14 8V4z" fill="currentColor"/></svg>
    );
    case 'play-circle': return (
      <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z" fill="currentColor"/></svg>
    );
    case 'python': return (
      <svg {...props}><path d="M9 3h6a3 3 0 0 1 3 3v3H9a3 3 0 0 0-3 3v3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/><path d="M15 21H9a3 3 0 0 1-3-3v-3h9a3 3 0 0 0 3-3V9h0a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3z"/><circle cx="9" cy="6.5" r="0.5" fill="currentColor"/><circle cx="15" cy="17.5" r="0.5" fill="currentColor"/></svg>
    );
    case 'stop': return (
      <svg {...props}><rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/></svg>
    );
    case 'plus': return (
      <svg {...props}><path d="M12 5v14M5 12h14"/></svg>
    );
    case 'minus': return (
      <svg {...props}><path d="M5 12h14"/></svg>
    );
    case 'search': return (
      <svg {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    );
    case 'filter': return (
      <svg {...props}><path d="M3 5h18l-7 9v6l-4-2v-4z"/></svg>
    );
    case 'refresh': return (
      <svg {...props}><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>
    );
    case 'chevron-right': return (
      <svg {...props}><path d="m9 6 6 6-6 6"/></svg>
    );
    case 'chevron-down': return (
      <svg {...props}><path d="m6 9 6 6 6-6"/></svg>
    );
    case 'chevron-up': return (
      <svg {...props}><path d="m6 15 6-6 6 6"/></svg>
    );
    case 'close': return (
      <svg {...props}><path d="M6 6l12 12M18 6 6 18"/></svg>
    );
    case 'loader': return (
      <svg {...props} className="spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
    );
    case 'star': return (
      <svg {...props}><path d="m12 3 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18l-5.9 3 1.2-6.5L2.5 9.9 9.1 9z"/></svg>
    );
    case 'clock': return (
      <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
    );
    case 'settings': return (
      <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
    );
    case 'home': return (
      <svg {...props}><path d="m3 11 9-8 9 8M5 10v10h14V10"/></svg>
    );
    case 'terminal': return (
      <svg {...props}><path d="m4 7 4 5-4 5M12 17h8"/><rect x="2" y="3" width="20" height="18" rx="2"/></svg>
    );
    case 'columns': return (
      <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>
    );
    case 'alert': return (
      <svg {...props}><path d="m12 3 10 17H2z"/><path d="M12 10v5M12 18v.5"/></svg>
    );
    case 'anonymize': return (
      <svg {...props}><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="m4 4 16 16"/></svg>
    );
    case 'beaker': return (
      <svg {...props}><path d="M9 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-10V3"/><path d="M9 3h6M7 14h10"/></svg>
    );
    case 'check': return (
      <svg {...props}><path d="m5 12 5 5L20 7"/></svg>
    );
    case 'case': return (
      <svg {...props}><path d="m4 18 4-12 4 12M5 14h6"/><path d="M18 11v7M14 14a4 4 0 0 1 8 0v4"/></svg>
    );
    case 'cast': return (
      <svg {...props}><path d="M4 8h4M4 4v8M16 4l4 8-4 8M9 12h2M13 12h2"/></svg>
    );
    case 'caret-down': return (
      <svg {...props}><path d="m6 9 6 6 6-6" fill="currentColor" stroke="none"/></svg>
    );
    case 'dedupe': return (
      <svg {...props}><rect x="9" y="3" width="11" height="11" rx="2"/><rect x="4" y="10" width="11" height="11" rx="2"/><path d="m8 14 2 2 4-4"/></svg>
    );
    case 'dot': return (
      <svg {...props}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>
    );
    case 'edit': return (
      <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>
    );
    case 'sort-asc': return (
      <svg {...props}><path d="M11 17V7M7 11l4-4 4 4M17 17v0"/></svg>
    );
    case 'shield': return (
      <svg {...props}><path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3z"/></svg>
    );
    case 'sliders': return (
      <svg {...props}><path d="M4 6h12M4 12h7M4 18h14"/><circle cx="18" cy="6" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
    );
    case 'spark': return (
      <svg {...props}><path d="m12 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></svg>
    );
    case 'export': return (
      <svg {...props}><path d="M12 3v12M7 8l5-5 5 5M5 21h14"/></svg>
    );
    case 'import': return (
      <svg {...props}><path d="M12 21V9M7 16l5 5 5-5M5 3h14"/></svg>
    );
    case 'grip': return (
      <svg {...props}><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
    );
    case 'group': return (
      <svg {...props}><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="9" y="13" width="7" height="7" rx="1"/></svg>
    );
    case 'book': return (
      <svg {...props}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z"/></svg>
    );
    case 'history': return (
      <svg {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v5l3 2"/></svg>
    );
    case 'js': return (
      <svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10 10v6a2 2 0 0 1-4 0M14 16a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2c0-2-5-2-5-4a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2"/></svg>
    );
    case 'sun': return (
      <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    );
    case 'mapping': return (
      <svg {...props}><rect x="3" y="5" width="6" height="14" rx="1"/><rect x="15" y="5" width="6" height="14" rx="1"/><path d="M9 9h6M9 12h6M9 15h6"/></svg>
    );
    case 'maximize': return (
      <svg {...props}><path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/></svg>
    );
    case 'merge': return (
      <svg {...props}><path d="M8 3v6c0 2 2 4 4 4s4 2 4 4v4M16 3v6"/><path d="m13 6 3-3 3 3M5 6l3-3 3 3"/></svg>
    );
    case 'moon': return (
      <svg {...props}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    );
    case 'sunrise': return (
      <svg {...props}><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><path d="m4.22 10.22 1.42 1.42M1 18h2M21 18h2M18.36 11.64l1.42-1.42"/><polyline points="8 5 12 1 16 5"/><line x1="1" y1="22" x2="23" y2="22"/></svg>
    );
    case 'upload': return (
      <svg {...props}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    );
    case 'trash': return (
      <svg {...props}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
    );
    case 'info': return (
      <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
    );
    case 'list': return (
      <svg {...props}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    );
    case 'folder': return (
      <svg {...props}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    );
    case 'file': return (
      <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    );
    case 'file-csv': return (
      <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2M12 13h2M16 13h0M8 17h2M12 17h2M16 17h0"/></svg>
    );
    case 'file-json': return (
      <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10 14c-1 0-1 1-1 2s0 2 1 2M14 14c1 0 1 1 1 2s0 2-1 2"/></svg>
    );
    case 'file-pq': return (
      <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><rect x="7" y="13" width="2" height="5"/><rect x="11" y="11" width="2" height="7"/><rect x="15" y="14" width="2" height="4"/></svg>
    );
    case 'fill': return (
      <svg {...props}><path d="M5 11 12 4l7 7-7 7z"/><path d="M19 13c0 2 2 4 2 6a2 2 0 0 1-4 0c0-2 2-4 2-6z"/></svg>
    );
    case 'fn': return (
      <svg {...props}><path d="M4 19s2 1 4-3 4-12 6-12 1 3 1 3"/><path d="M3 13h8"/></svg>
    );
    case 'eye': return (
      <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    );
    case 'eye-off': return (
      <svg {...props}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    );
    case 'trim': return (
      <svg {...props}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m20 4-14 14M20 20 8 8"/></svg>
    );
    case 'union': return (
      <svg {...props}><path d="M5 4v8a7 7 0 0 0 14 0V4"/></svg>
    );
    case 'warning-triangle': return (
      <svg {...props}><path d="m12 3 10 17H2z"/><path d="M12 10v5M12 18v.5"/></svg>
    );
    default: return null;
  }
}
