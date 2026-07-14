'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={id}
            className="block text-sm font-medium text-slate-700"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'flex min-h-[100px] w-full rounded-lg border bg-white px-3 py-2 text-sm transition-colors',
            'placeholder:text-slate-400 resize-y',
            'focus:outline-none focus:ring-2 focus:ring-firm-accent focus:border-transparent',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50',
            error
              ? 'border-red-300 focus:ring-red-500'
              : 'border-slate-300',
            className,
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  },
);

Textarea.displayName = 'Textarea';
