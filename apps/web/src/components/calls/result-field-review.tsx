'use client';

import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfidenceBar } from '@/components/ui/confidence-bar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ReviewStatus } from '@outbound-call/shared';

interface ResultFieldReviewProps {
  fieldId: string;
  fieldKey: string;
  fieldLabel: string;
  extractedValue: unknown;
  confidence: number;
  reviewStatus: ReviewStatus;
  reviewedValue: unknown;
  onAccept: (fieldId: string) => void;
  onEdit: (fieldId: string, newValue: string) => void;
  onReject: (fieldId: string) => void;
  onViewEvidence?: (fieldId: string) => void;
}

export function ResultFieldReview({
  fieldId,
  fieldLabel,
  extractedValue,
  confidence,
  reviewStatus,
  reviewedValue,
  onAccept,
  onEdit,
  onReject,
  onViewEvidence,
}: ResultFieldReviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(extractedValue ?? ''));

  const displayValue = reviewStatus === 'edited' ? String(reviewedValue) : String(extractedValue ?? '—');

  const statusVariant: Record<ReviewStatus, 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'secondary'> = {
    pending: 'secondary',
    accepted: 'success',
    edited: 'info',
    rejected: 'destructive',
  };

  const handleSaveEdit = () => {
    onEdit(fieldId, editValue);
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-colors',
        reviewStatus === 'accepted' && 'border-emerald-200 bg-emerald-50/50',
        reviewStatus === 'edited' && 'border-blue-200 bg-blue-50/50',
        reviewStatus === 'rejected' && 'border-red-200 bg-red-50/50',
        reviewStatus === 'pending' && 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-slate-900">{fieldLabel}</h4>
            <Badge variant={statusVariant[reviewStatus]}>
              {reviewStatus}
            </Badge>
          </div>

          {isEditing ? (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="flex-1 h-8 px-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-firm-accent"
                autoFocus
              />
              <Button size="sm" onClick={handleSaveEdit}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-700 mt-1 font-mono">
              {displayValue}
            </p>
          )}

          <div className="mt-2 flex items-center gap-3">
            <ConfidenceBar value={confidence} className="w-32" />
            {onViewEvidence && (
              <button
                onClick={() => onViewEvidence(fieldId)}
                className="text-xs text-firm-accent hover:underline"
              >
                View evidence
              </button>
            )}
          </div>
        </div>

        {reviewStatus === 'pending' && !isEditing && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onAccept(fieldId)}
              title="Accept"
            >
              <Check className="h-4 w-4 text-emerald-600" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              title="Edit"
            >
              <Pencil className="h-4 w-4 text-blue-600" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onReject(fieldId)}
              title="Reject"
            >
              <X className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
