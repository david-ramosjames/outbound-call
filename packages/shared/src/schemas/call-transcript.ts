import { z } from 'zod';
import { SPEAKERS } from '../types/speakers';

export const transcriptSegmentSchema = z.object({
  id: z.string().uuid(),
  callMissionId: z.string().uuid(),
  callSessionId: z.string().uuid(),
  sourceEventId: z.string().uuid().nullable(),
  speaker: z.enum(SPEAKERS),
  text: z.string(),
  startTimeMs: z.number(),
  endTimeMs: z.number(),
  sequenceNumber: z.number(),
  isFinal: z.boolean(),
  createdAt: z.string(),
});

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
