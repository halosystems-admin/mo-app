import { useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';

interface Props {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
  duration?: number;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const STYLES = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-rose-50 border-rose-200 text-rose-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const ICON_STYLES = {
  success: 'text-emerald-500',
  error: 'text-rose-500',
  info: 'text-blue-500',
};

export const Toast: React.FC<Props> = ({ message, type, onClose, duration = 4000 }) => {
  const Icon = ICONS[type];

  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  return (
    <div className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] animate-in slide-in-from-top-4 fade-in duration-300 sm:right-6 sm:top-6">
      <div className={`flex max-w-[min(22rem,calc(100vw-1.5rem))] items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${STYLES[type]}`}>
        <Icon className={`w-5 h-5 shrink-0 ${ICON_STYLES[type]}`} />
        <p className="text-sm font-medium flex-1">{message}</p>
        <button
          onClick={onClose}
          className="halo-touch-min rounded-full p-1 transition-colors hover:bg-black/5 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
