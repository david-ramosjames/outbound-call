import { cn } from '@/lib/utils';

interface ConfidenceBarProps {
  value: number;
  showLabel?: boolean;
  className?: string;
}

export function ConfidenceBar({ value, showLabel = true, className }: ConfidenceBarProps) {
  const percentage = Math.round(value * 100);

  const getColor = () => {
    if (value >= 0.8) return 'bg-emerald-500';
    if (value >= 0.6) return 'bg-amber-500';
    return 'bg-red-500';
  };

  const getTextColor = () => {
    if (value >= 0.8) return 'text-emerald-700';
    if (value >= 0.6) return 'text-amber-700';
    return 'text-red-700';
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', getColor())}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn('text-xs font-medium tabular-nums', getTextColor())}>
          {percentage}%
        </span>
      )}
    </div>
  );
}
