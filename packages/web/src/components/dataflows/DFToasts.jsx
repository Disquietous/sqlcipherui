import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');
const ICONS = { error: 'alert', ok: 'check', info: 'info' };

export default function DFToasts() {
  const toasts = useDataFlowStore((s) => s.toasts);
  const dismissToast = useDataFlowStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="df-toasts" role="region" aria-label="Notifications">
      {toasts.map(t => (
        <div key={t.id} className={cx('df-toast', `level-${t.level || 'info'}`)}
             role={t.level === 'error' ? 'alert' : 'status'}>
          <Icon name={ICONS[t.level] || 'info'} size={13} />
          <span className="df-toast-msg">{t.message}</span>
          <button className="iconbtn-sm df-toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" title="Dismiss">
            <Icon name="close" size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
