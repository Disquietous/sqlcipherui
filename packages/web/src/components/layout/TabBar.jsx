import { Icon } from '../icons/Icon';
import { useTabsStore } from '../../stores/tabs';

const cx = (...xs) => xs.filter(Boolean).join(' ');

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, openQuery } = useTabsStore();

  return (
    <div className="tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
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
      <button className="tab-new" onClick={() => openQuery()} title="New tab">
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}
