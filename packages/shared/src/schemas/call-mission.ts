import { z } from 'zod';
import { CALL_STATUSES, MISSION_OUTCOMES } from '../types/call-status.js';
import { MISSION_TYPES } from '../types/mission-types.js';

export const destinationSchema = z.object({
  organizationName: z.string().min(1, 'Organization name is required'),
  department: z.string().optional(),
  contactName: z.string().optional(),
  phoneNumber: z.string().min(10, 'Valid phone number required'),
  extension: z.string().optional(),
  destinationTimezone: z.string().default('America/Chicago'),
});

export const approvedContextItemSchema = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
  included: z.boolean(),
  missionSpecificValue: z.string().optional(),
});

export const missionInstructionsSchema = z.object({
  goal: z.string().min(1, 'Goal is required'),
  objectives: z.array(z.string()),
  successCriteria: z.array(z.string()),
  requiredInformation: z.array(z.string()),
  allowedDisclosures: z.array(z.string()),
  restrictedTopics: z.array(z.string()),
  escalationConditions: z.array(z.string()),
  additionalInstructions: z.string().optional(),
});

export const createCallMissionSchema = z.object({
  caseId: z.string().uuid(),
  missionType: z.enum(MISSION_TYPES),
  title: z.string().min(1),
  destination: destinationSchema,
  approvedContext: z.array(approvedContextItemSchema),
  instructions: missionInstructionsSchema,
});

export const callMissionSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  missionType: z.enum(MISSION_TYPES),
  title: z.string(),
  organizationName: z.string(),
  department: z.string().nullable(),
  contactName: z.string().nullable(),
  destinationPhone: z.string(),
  extension: z.string().nullable(),
  destinationTimezone: z.string(),
  goal: z.string(),
  objectives: z.array(z.string()),
  successCriteria: z.array(z.string()),
  approvedContext: z.array(approvedContextItemSchema),
  allowedDisclosures: z.array(z.string()),
  restrictedTopics: z.array(z.string()),
  escalationRules: z.array(z.string()),
  expectedOutputSchema: z.record(z.unknown()).nullable(),
  promptSnapshot: z.string().nullable(),
  authorizationSnapshot: z.record(z.unknown()).nullable(),
  correlationToken: z.string().uuid().nullable(),
  status: z.enum(CALL_STATUSES),
  outcome: z.enum(MISSION_OUTCOMES).nullable(),
  createdBy: z.string().uuid(),
  authorizedBy: z.string().uuid().nullable(),
  authorizedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  holdDurationSeconds: z.number().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Destination = z.infer<typeof destinationSchema>;
export type ApprovedContextItem = z.infer<typeof approvedContextItemSchema>;
export type MissionInstructions = z.infer<typeof missionInstructionsSchema>;
export type CreateCallMission = z.infer<typeof createCallMissionSchema>;
export type CallMission = z.infer<typeof callMissionSchema>;
