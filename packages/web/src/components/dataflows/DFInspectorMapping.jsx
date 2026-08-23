import { useState, useRef, useEffect } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function DFInspectorMapping({ node }) {
  const mappingData = useDataFlowStore((s) => s.mappingData);
  const leftRefs = useRef({});
  const rightRefs = useRef({});
  const containerRef = useRef(null);
  const [, force] = useState(0);
  useEffect(() => { force(x => x + 1); }, []);

  const mapLeft = mappingData?.left || [];
  const mapRight = mappingData?.right || [];
  const mapLinks = mappingData?.links || [];

  if (mapLeft.length === 0 && mapRight.length === 0) {
    return (
      <div className="df-empty">
        <Icon name="mapping" size={14} /><br />
        No column mapping available.<br />
        <span className="muted small">Connect source and target nodes to see mappings.</span>
      </div>
    );
  }

  const linePos = () => {
    if (!containerRef.current) return [];
    const cBox = containerRef.current.getBoundingClientRect();
    return mapLinks.map(link => {
      const l = leftRefs.current[link.left]?.getBoundingClientRect();
      const r = rightRefs.current[link.right]?.getBoundingClientRect();
      if (!l || !r) return null;
      return {
        x1: l.right - cBox.left,
        y1: l.top + l.height / 2 - cBox.top,
        x2: r.left - cBox.left,
        y2: r.top + r.height / 2 - cBox.top,
        link,
      };
    }).filter(Boolean);
  };

  const lines = linePos();

  return (
    <div className="df-mapping" ref={containerRef}>
      <div className="df-mapping-head">
        <div className="df-mapping-side-head">
          <span>Source</span>
          <span className="muted small">{mapLeft.length} columns</span>
        </div>
        <div></div>
        <div className="df-mapping-side-head">
          <span>Target</span>
          <span className="muted small">{mapRight.length} columns</span>
        </div>
      </div>
      <div className="df-mapping-grid">
        <div className="df-mapping-col">
          {mapLeft.map(c => (
            <div key={c.name} className="df-map-row" ref={el => leftRefs.current[c.name] = el}>
              <span className="df-map-port"></span>
              <span className="df-map-name mono">{c.name}</span>
              <span className="df-map-type mono muted small">{c.type.toLowerCase()}</span>
            </div>
          ))}
        </div>
        <div className="df-mapping-mid">
          <svg width="100%" height="100%">
            {lines.map((ln, i) => (
              <path key={i}
                d={`M ${ln.x1} ${ln.y1} C ${(ln.x1 + ln.x2) / 2} ${ln.y1}, ${(ln.x1 + ln.x2) / 2} ${ln.y2}, ${ln.x2} ${ln.y2}`}
                stroke="var(--accent)"
                strokeWidth="1.6" fill="none" opacity="0.85" />
            ))}
          </svg>
        </div>
        <div className="df-mapping-col">
          {mapRight.map(c => (
            <div key={c.name} className={cx('df-map-row', c.expr && 'has-expr')} ref={el => rightRefs.current[c.name] = el}>
              <span className="df-map-port left-port"></span>
              <span className="df-map-name mono">
                {c.pk && <Icon name="key" size={9} style={{ color: 'var(--accent)', marginRight: 4 }} />}
                {c.name}
              </span>
              <span className="df-map-type mono muted small">{c.type.toLowerCase()}</span>
              {c.expr && <span className="df-map-expr mono">{c.expr}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="df-mapping-foot">
        <span className="muted small">{mapLinks.length} of {mapRight.length} target columns mapped</span>
        <div style={{ flex: 1 }}></div>
        <button className="btn small"><Icon name="check" size={11} /> Auto-map by name</button>
        <button className="btn small">Clear all</button>
      </div>
    </div>
  );
}
