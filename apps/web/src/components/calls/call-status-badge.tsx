import {
  Phone,
  PhoneCall,
  PhoneOff,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  FileSearch,
  FileCheck,
  Pause,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { CallStatus, MissionOutcome } from '@outbound-call/shared';

const statusConfig: Record<
  CallStatus,
  { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'secondary'; icon: React.ReactNode }
> = {
  draft: { label: 'Draft', variant: 'secondary', icon: <Clock className="h-3 w-3" /> },
  authorized: { label: 'Authorized', variant: 'info', icon: <CheckCircle2 className="h-3 w-3" /> },
  queued: { label: 'Queued', variant: 'info', icon: <Clock className="h-3 w-3" /> },
  initiating: { label: 'Initiating', variant: 'info', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  dialing: { label: 'Dialing', variant: 'info', icon: <Phone className="h-3 w-3" /> },
  ringing: { label: 'Ringing', variant: 'info', icon: <Phone className="h-3 w-3 animate-pulse" /> },
  answered: { label: 'Answered', variant: 'info', icon: <PhoneCall className="h-3 w-3" /> },
  in_progress: { label: 'In Progress', variant: 'info', icon: <PhoneCall className="h-3 w-3 animate-pulse" /> },
  on_hold: { label: 'On Hold', variant: 'warning', icon: <Pause className="h-3 w-3" /> },
  completed: { label: 'Completed', variant: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: 'Failed', variant: 'destructive', icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: <PhoneOff className="h-3 w-3" /> },
  needs_human_follow_up: { label: 'Needs Follow-up', variant: 'warning', icon: <AlertTriangle className="h-3 w-3" /> },
  awaiting_review: { label: 'Awaiting Review', variant: 'warning', icon: <FileSearch className="h-3 w-3" /> },
  reviewed: { label: 'Reviewed', variant: 'success', icon: <FileCheck className="h-3 w-3" /> },
};

const outcomeConfig: Record<
  MissionOutcome,
  { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'secondary' }
> = {
  success: { label: 'Success', variant: 'success' },
  partial_success: { label: 'Partial Success', variant: 'warning' },
  failure: { label: 'Failed', variant: 'destructive' },
  human_follow_up: { label: 'Human Follow-up', variant: 'warning' },
};

interface CallStatusBadgeProps {
  status: CallStatus;
  className?: string;
}

export function CallStatusBadge({ status, className }: CallStatusBadgeProps) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={className}>
      <span className="flex items-center gap-1">
        {config.icon}
        {config.label}
      </span>
    </Badge>
  );
}

interface OutcomeBadgeProps {
  outcome: MissionOutcome | null;
  className?: string;
}

export function OutcomeBadge({ outcome, className }: OutcomeBadgeProps) {
  if (!outcome) return <Badge variant="secondary" className={className}>Pending</Badge>;
  const config = outcomeConfig[outcome];
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
