import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons/Icon';
import { useTabsStore } from '../../stores/tabs';

const cx = (...xs) => xs.filter(Boolean).join(' ');
const SCROLL_STEP = 200;

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, openQuery } = useTabsStore();
  const stripRef = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = max > 1 && el.scrollLeft < max - 1;
    setOverflow(o => (o.left === left && o.right === right ? o : { left, right }));
  }, []);

  // Re-measure when tabs change or the container resizes.
  useLayoutEffect(() => {
    measure();
    const el = stripRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, tabs.length]);

  // Keep the active tab visible when it changes.
  useEffect(() => {
    const el = stripRef.current;
    if (!el || !activeTabId) return;
    const node = el.querySelector(`[data-tab-id="${CSS.escape(activeTabId)}"]`);
    if (node) node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  const scrollBy = (dx) => {
    stripRef.current?.scrollBy({ left: dx, behavior: 'smooth' });
  };

  const hasOverflow = overflow.left || overflow.right;

  return (
    <div className="tabs">
      {hasOverflow && (
        <button
          className="tab-scroll"
          disabled={!overflow.left}
          onClick={() => scrollBy(-SCROLL_STEP)}
          title="Scroll tabs left"
        >
          <Icon name="chevron-left" size={12} />
        </button>
      )}
      <div className="tabs-strip" ref={stripRef} onScroll={measure}>
        {tabs.map((t) => (
          <div
            key={t.id}
            data-tab-id={t.id}
            className={cx('tab', activeTabId === t.id && 'is-active')}
            onClick={() => setActiveTab(t.id)}
          >
            <Icon name={t.icon} size={12} />
            <span className="tab-title">{t.title}</span>
            {t.dirty && <span className="tab-dirty">&bull;</span>}
            <button className="tab-close" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}>
              <Icon name="close" size={24} />
            </button>
          </div>
        ))}
      </div>
      {hasOverflow && (
        <button
          className="tab-scroll"
          disabled={!overflow.right}
          onClick={() => scrollBy(SCROLL_STEP)}
          title="Scroll tabs right"
        >
          <Icon name="chevron-right" size={12} />
        </button>
      )}
      <button className="tab-new" onClick={() => openQuery()} title="New tab">
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}
