import { cn } from '@/lib/utils';

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: CardProps) {
  return (
    <div className={cn('border-b border-slate-100 px-6 py-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ className, children }: CardProps) {
  return (
    <h3 className={cn('text-lg font-semibold text-slate-900', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ className, children }: CardProps) {
  return (
    <p className={cn('text-sm text-slate-500 mt-1', className)}>
      {children}
    </p>
  );
}

export function CardContent({ className, children }: CardProps) {
  return <div className={cn('px-6 py-4', className)}>{children}</div>;
}

export function CardFooter({ className, children }: CardProps) {
  return (
    <div
      className={cn('border-t border-slate-100 px-6 py-4 flex items-center', className)}
    >
      {children}
    </div>
  );
}
