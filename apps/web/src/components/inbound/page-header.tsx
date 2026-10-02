import { AlertTriangle } from 'lucide-react';

export function InboundPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-navy-600">Inbound Intake</p>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">{description}</p>
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin h-8 w-8 border-4 border-navy-200 border-t-navy-700 rounded-full" />
    </div>
  );
}

export function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2">
      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="text-xs text-amber-800">{children}</div>
    </div>
  );
}

export function SaveMessage({ message }: { message: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!message) return null;
  return (
    <span className={message.kind === 'ok' ? 'text-sm text-emerald-600 font-medium' : 'text-sm text-red-600'}>
      {message.text}
    </span>
  );
}

export const selectClass =
  'flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent';
