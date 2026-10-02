import { AlertTriangle } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { QUALIFICATION_RESULT_LABELS, type QualificationResultValue } from '@outbound-call/shared';

const QUALIFICATION_VARIANT: Record<QualificationResultValue, NonNullable<BadgeProps['variant']>> = {
  high_priority: 'destructive',
  qualified: 'success',
  needs_review: 'warning',
  not_qualified: 'secondary',
};

export function QualificationBadge({ result }: { result: string | null | undefined }) {
  if (!result || !(result in QUALIFICATION_VARIANT)) return <Badge variant="default">Not evaluated</Badge>;
  const r = result as QualificationResultValue;
  return (
    <Badge variant={QUALIFICATION_VARIANT[r]} className={r === 'high_priority' ? 'font-semibold' : undefined}>
      {r === 'high_priority' && <AlertTriangle className="h-3 w-3 mr-1" />}
      {QUALIFICATION_RESULT_LABELS[r]}
    </Badge>
  );
}

const STATUS_LABELS: Record<string, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  active: { label: 'In progress', variant: 'info' },
  incomplete: { label: 'Incomplete', variant: 'warning' },
  qualified: { label: 'Qualified', variant: 'success' },
  needs_review: { label: 'Needs review', variant: 'warning' },
  transferred: { label: 'Transferred', variant: 'info' },
  contract_sent: { label: 'Contract sent', variant: 'info' },
  contract_signed: { label: 'Signed', variant: 'success' },
  declined: { label: 'Declined', variant: 'secondary' },
  spam: { label: 'Spam', variant: 'secondary' },
  existing_client: { label: 'Existing client', variant: 'default' },
  other: { label: 'Other', variant: 'default' },
};

export function IntakeStatusBadge({ status }: { status: string | null | undefined }) {
  const s = STATUS_LABELS[status ?? ''] ?? { label: status ?? '—', variant: 'default' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const CALL_STATUS: Record<string, { label: string; variant: NonNullable<BadgeProps['variant']> }> = {
  ringing: { label: 'Ringing', variant: 'info' },
  in_progress: { label: 'Live', variant: 'destructive' },
  transferring: { label: 'Transferring', variant: 'warning' },
  transferred: { label: 'Transferred', variant: 'info' },
  completed: { label: 'Completed', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
};

export function InboundCallStatusBadge({ status }: { status: string | null | undefined }) {
  const s = CALL_STATUS[status ?? ''] ?? { label: status ?? '—', variant: 'default' as const };
  return (
    <Badge variant={s.variant}>
      {status === 'in_progress' && <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />}
      {s.label}
    </Badge>
  );
}
