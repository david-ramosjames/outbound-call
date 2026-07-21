import type { CallMission, CallStatus, MissionOutcome, VoiceSettings } from '@outbound-call/shared';
import { MISSION_TYPES, DEFAULT_VOICE_SETTINGS } from '@outbound-call/shared';

/**
 * Supabase returns snake_case rows. CallMission / prompt builder use camelCase.
 * Accept either shape so mock and live paths both work.
 */
export function mapDbMissionToCallMission(row: Record<string, unknown>): CallMission {
  const str = (camel: string, snake: string, fallback = ''): string => {
    const v = row[camel] ?? row[snake];
    return typeof v === 'string' ? v : fallback;
  };

  const strOrNull = (camel: string, snake: string): string | null => {
    const v = row[camel] ?? row[snake];
    if (v == null) return null;
    return typeof v === 'string' ? v : String(v);
  };

  const strArray = (camel: string, snake: string): string[] => {
    const v = row[camel] ?? row[snake];
    if (Array.isArray(v)) return v.map(String);
    return [];
  };

  const missionTypeRaw = (row.missionType ?? row.mission_type ?? 'open_insurance_claim') as string;
  const missionType = (MISSION_TYPES as readonly string[]).includes(missionTypeRaw)
    ? (missionTypeRaw as CallMission['missionType'])
    : 'open_insurance_claim';

  const approvedRaw = row.approvedContext ?? row.approved_context ?? [];
  const approvedContext = Array.isArray(approvedRaw)
    ? approvedRaw.map((item) => {
        const c = (item ?? {}) as Record<string, unknown>;
        return {
          field: String(c.field ?? ''),
          label: String(c.label ?? c.field ?? ''),
          value: String(c.value ?? ''),
          included: Boolean(c.included),
          missionSpecificValue:
            c.missionSpecificValue != null
              ? String(c.missionSpecificValue)
              : c.mission_specific_value != null
                ? String(c.mission_specific_value)
                : undefined,
        };
      })
    : [];

  return {
    id: str('id', 'id'),
    caseId: str('caseId', 'case_id'),
    missionType,
    title: str('title', 'title'),
    organizationName: str('organizationName', 'organization_name'),
    department: strOrNull('department', 'department'),
    contactName: strOrNull('contactName', 'contact_name'),
    destinationPhone: str('destinationPhone', 'destination_phone'),
    extension: strOrNull('extension', 'extension'),
    destinationTimezone: str('destinationTimezone', 'destination_timezone', 'America/Chicago'),
    goal: str('goal', 'goal'),
    objectives: strArray('objectives', 'objectives'),
    successCriteria: strArray('successCriteria', 'success_criteria'),
    approvedContext,
    allowedDisclosures: strArray('allowedDisclosures', 'allowed_disclosures'),
    restrictedTopics: strArray('restrictedTopics', 'restricted_topics'),
    escalationRules: strArray('escalationRules', 'escalation_rules'),
    expectedOutputSchema:
      ((row.expectedOutputSchema ?? row.expected_output_schema) as Record<string, unknown> | null) ??
      null,
    promptSnapshot: strOrNull('promptSnapshot', 'prompt_snapshot'),
    authorizationSnapshot:
      ((row.authorizationSnapshot ?? row.authorization_snapshot) as Record<string, unknown> | null) ??
      null,
    correlationToken: strOrNull('correlationToken', 'correlation_token'),
    status: (str('status', 'status', 'queued') as CallStatus),
    outcome: (strOrNull('outcome', 'outcome') as MissionOutcome | null),
    createdBy: str('createdBy', 'created_by'),
    authorizedBy: strOrNull('authorizedBy', 'authorized_by'),
    authorizedAt: strOrNull('authorizedAt', 'authorized_at'),
    startedAt: strOrNull('startedAt', 'started_at'),
    answeredAt: strOrNull('answeredAt', 'answered_at'),
    completedAt: strOrNull('completedAt', 'completed_at'),
    durationSeconds:
      typeof (row.durationSeconds ?? row.duration_seconds) === 'number'
        ? (row.durationSeconds as number) ?? (row.duration_seconds as number)
        : null,
    holdDurationSeconds:
      typeof (row.holdDurationSeconds ?? row.hold_duration_seconds) === 'number'
        ? (row.holdDurationSeconds as number) ?? (row.hold_duration_seconds as number)
        : null,
    failureReason: strOrNull('failureReason', 'failure_reason'),
    createdAt: str('createdAt', 'created_at'),
    updatedAt: str('updatedAt', 'updated_at'),
  };
}

export function mapDbVoiceSettings(
  row: Record<string, unknown> | null | undefined,
): VoiceSettings {
  if (!row) {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      ...DEFAULT_VOICE_SETTINGS,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  const pickStr = (camel: string, snake: string, fallback: string): string => {
    const v = row[camel] ?? row[snake];
    return typeof v === 'string' && v.length > 0 ? v : fallback;
  };

  const pickBool = (camel: string, snake: string, fallback: boolean): boolean => {
    const v = row[camel] ?? row[snake];
    return typeof v === 'boolean' ? v : fallback;
  };

  const pickNum = (camel: string, snake: string, fallback: number): number => {
    const v = row[camel] ?? row[snake];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };

  return {
    id: pickStr('id', 'id', '00000000-0000-0000-0000-000000000000'),
    aiDisclosureText: pickStr(
      'aiDisclosureText',
      'ai_disclosure_text',
      DEFAULT_VOICE_SETTINGS.aiDisclosureText,
    ),
    recordingDisclosureText: pickStr(
      'recordingDisclosureText',
      'recording_disclosure_text',
      DEFAULT_VOICE_SETTINGS.recordingDisclosureText,
    ),
    recordingEnabled: pickBool(
      'recordingEnabled',
      'recording_enabled',
      DEFAULT_VOICE_SETTINGS.recordingEnabled,
    ),
    allowedCallStartTime: pickStr(
      'allowedCallStartTime',
      'allowed_call_start_time',
      DEFAULT_VOICE_SETTINGS.allowedCallStartTime,
    ),
    allowedCallEndTime: pickStr(
      'allowedCallEndTime',
      'allowed_call_end_time',
      DEFAULT_VOICE_SETTINGS.allowedCallEndTime,
    ),
    maximumCallDurationSeconds: pickNum(
      'maximumCallDurationSeconds',
      'maximum_call_duration_seconds',
      DEFAULT_VOICE_SETTINGS.maximumCallDurationSeconds,
    ),
    maximumHoldDurationSeconds: pickNum(
      'maximumHoldDurationSeconds',
      'maximum_hold_duration_seconds',
      DEFAULT_VOICE_SETTINGS.maximumHoldDurationSeconds,
    ),
    defaultVoice: pickStr(
      'defaultVoice',
      'default_voice',
      DEFAULT_VOICE_SETTINGS.defaultVoice,
    ),
    isEnabled: pickBool('isEnabled', 'is_enabled', DEFAULT_VOICE_SETTINGS.isEnabled),
    createdAt: pickStr('createdAt', 'created_at', new Date().toISOString()),
    updatedAt: pickStr('updatedAt', 'updated_at', new Date().toISOString()),
  };
}
