'use client';

import { useState } from 'react';
import { ArrowRight, Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReviewStatus } from '@outbound-call/shared';

interface ProposedUpdateCardProps {
  updateId: string;
  targetField: string;
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  reviewStatus: ReviewStatus;
  reviewedValue: unknown;
  onAccept: (updateId: string) => void;
  onEdit: (updateId: string, newValue: string) => void;
  onReject: (updateId: string) => void;
}

export function ProposedUpdateCard({
  updateId,
  targetField,
  currentValue,
  proposedValue,
  reason,
  reviewStatus,
  reviewedValue,
  onAccept,
  onEdit,
  onReject,
}: ProposedUpdateCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(proposedValue ?? ''));

  const displayProposed =
    reviewStatus === 'edited' ? String(reviewedValue) : String(proposedValue ?? '—');

  const statusVariant: Record<ReviewStatus, 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'secondary'> = {
    pending: 'secondary',
    accepted: 'success',
    edited: 'info',
    rejected: 'destructive',
  };

  const handleSaveEdit = () => {
    onEdit(updateId, editValue);
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        reviewStatus === 'accepted' && 'border-emerald-200 bg-emerald-50/50',
        reviewStatus === 'edited' && 'border-blue-200 bg-blue-50/50',
        reviewStatus === 'rejected' && 'border-red-200 bg-red-50/50',
        reviewStatus === 'pending' && 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold text-slate-900">
              {targetField.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </h4>
            <Badge variant={statusVariant[reviewStatus]}>{reviewStatus}</Badge>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              {String(currentValue ?? '(empty)')}
            </span>
            <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            {isEditing ? (
              <div className="flex gap-2 flex-1">
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="flex-1 h-7 px-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-firm-accent"
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveEdit}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <span className="font-mono text-navy-800 bg-navy-50 px-2 py-0.5 rounded font-medium">
                {displayProposed}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-500 mt-2">{reason}</p>
        </div>

        {reviewStatus === 'pending' && !isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => onAccept(updateId)} title="Accept">
              <Check className="h-4 w-4 text-emerald-600" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} title="Edit">
              <Pencil className="h-4 w-4 text-blue-600" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReject(updateId)} title="Reject">
              <X className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
