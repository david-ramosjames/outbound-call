import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  title: string;
  description?: string;
}

interface StepsProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export function Steps({ steps, currentStep, className }: StepsProps) {
  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      <ol className="flex items-center">
        {steps.map((step, index) => {
          const status =
            index < currentStep
              ? 'complete'
              : index === currentStep
                ? 'current'
                : 'upcoming';

          return (
            <li
              key={step.title}
              className={cn(
                'relative flex-1',
                index !== steps.length - 1 && 'pr-8 sm:pr-20',
              )}
            >
              <div className="flex items-center">
                <div
                  className={cn(
                    'relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold',
                    status === 'complete' &&
                      'bg-navy-700 text-white',
                    status === 'current' &&
                      'border-2 border-navy-700 bg-white text-navy-700',
                    status === 'upcoming' &&
                      'border-2 border-slate-300 bg-white text-slate-400',
                  )}
                >
                  {status === 'complete' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                {index !== steps.length - 1 && (
                  <div
                    className={cn(
                      'absolute top-4 left-8 right-0 h-0.5 -translate-y-1/2',
                      index < currentStep ? 'bg-navy-700' : 'bg-slate-200',
                    )}
                  />
                )}
              </div>
              <div className="mt-2">
                <span
                  className={cn(
                    'text-xs font-medium',
                    status === 'current'
                      ? 'text-navy-800'
                      : status === 'complete'
                        ? 'text-navy-600'
                        : 'text-slate-400',
                  )}
                >
                  {step.title}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
