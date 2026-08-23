import { Icon } from '../icons/Icon';
import { useUiStore } from '../../stores/ui';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const ITEMS = [
  { id: 'dashboard', icon: 'home',     label: 'Home'      },
  { id: 'schema',    icon: 'database', label: 'Schema'    },
  { id: 'query',     icon: 'terminal', label: 'Query'     },
  { id: 'history',   icon: 'clock',    label: 'History'   },
  { id: 'cipher',    icon: 'shield',   label: 'Cipher'    },
  { id: 'settings',  icon: 'settings', label: 'Settings'  },
];

export function ActivityRail() {
  const { activeView, setActiveView } = useUiStore();

  return (
    <div className="rail">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={cx('rail-btn', activeView === it.id && 'is-active')}
          onClick={() => setActiveView(it.id)}
          title={it.label}
        >
          <Icon name={it.icon} size={18} stroke={1.7} />
          <span className="rail-label">{it.label}</span>
        </button>
      ))}
      <div style={{ flex: 1 }}></div>
      <div className="rail-bottom">
        <div className="rail-avatar" title="Local user">
          <Icon name="database" size={14} />
        </div>
      </div>
    </div>
  );
}
