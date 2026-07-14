import { AlertTriangle } from 'lucide-react';

export function MockModeBanner() {
  if (process.env.NEXT_PUBLIC_VOICE_MODE !== 'mock') return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center gap-3">
      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
      <div>
        <p className="text-sm font-semibold text-amber-800">
          Mock Mode Active
        </p>
        <p className="text-xs text-amber-700">
          No real calls will be made. All calls will be simulated for testing purposes.
        </p>
      </div>
    </div>
  );
}
