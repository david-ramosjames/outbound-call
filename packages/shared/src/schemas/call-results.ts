import { z } from 'zod';
import { MISSION_OUTCOMES, REVIEW_STATUSES } from '../types/call-status';

export const structuredResultSchema = z.object({
  missionOutcome: z.enum(MISSION_OUTCOMES),
  claimOpened: z.boolean(),
  existingClaimLocated: z.boolean(),
  claimNumber: z.string().nullable(),
  representativeName: z.string().nullable(),
  representativeDepartment: z.string().nullable(),
  adjusterName: z.string().nullable(),
  adjusterPhone: z.string().nullable(),
  adjusterEmail: z.string().nullable(),
  carrierFax: z.string().nullable(),
  carrierMailingAddress: z.string().nullable(),
  requestedDocuments: z.array(z.object({
    documentName: z.string(),
    deliveryMethod: z.string().nullable(),
    destination: z.string().nullable(),
    deadline: z.string().nullable(),
  })),
  missingInformation: z.array(z.object({
    field: z.string(),
    reason: z.string(),
    effect: z.string().nullable(),
    suggestedNextStep: z.string().nullable(),
  })),
  commitments: z.array(z.string()),
  deadlines: z.array(z.object({
    description: z.string(),
    date: z.string().nullable(),
  })),
  nextAction: z.string().nullable(),
  suggestedFollowUpDate: z.string().nullable(),
  escalationReason: z.string().nullable(),
  summary: z.string(),
  confidence: z.record(z.number()),
  evidence: z.record(z.array(z.string())),
});

export const callResultSchema = z.object({
  id: z.string().uuid(),
  callMissionId: z.string().uuid(),
  missionOutcome: z.enum(MISSION_OUTCOMES),
  completionStatus: z.string(),
  summary: z.string(),
  structuredResults: structuredResultSchema,
  requestedDocuments: z.array(z.unknown()),
  missingInformation: z.array(z.unknown()),
  commitments: z.array(z.string()),
  deadlines: z.array(z.unknown()),
  nextAction: z.string().nullable(),
  suggestedFollowUpDate: z.string().nullable(),
  escalationReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const callResultFieldSchema = z.object({
  id: z.string().uuid(),
  callResultId: z.string().uuid(),
  fieldKey: z.string(),
  fieldLabel: z.string(),
  extractedValue: z.unknown(),
  confidence: z.number().min(0).max(1),
  evidenceSegmentIds: z.array(z.string()),
  evidenceStartTimeMs: z.number().nullable(),
  evidenceEndTimeMs: z.number().nullable(),
  reviewStatus: z.enum(REVIEW_STATUSES),
  reviewedValue: z.unknown().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const callProposedUpdateSchema = z.object({
  id: z.string().uuid(),
  callMissionId: z.string().uuid(),
  targetType: z.string(),
  targetId: z.string().uuid(),
  targetField: z.string(),
  currentValue: z.unknown().nullable(),
  proposedValue: z.unknown(),
  reason: z.string(),
  reviewStatus: z.enum(REVIEW_STATUSES),
  reviewedValue: z.unknown().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type StructuredResult = z.infer<typeof structuredResultSchema>;
export type CallResult = z.infer<typeof callResultSchema>;
export type CallResultField = z.infer<typeof callResultFieldSchema>;
export type CallProposedUpdate = z.infer<typeof callProposedUpdateSchema>;
