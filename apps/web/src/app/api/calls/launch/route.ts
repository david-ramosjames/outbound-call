import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { normalizePhoneNumber, isValidE164, isWithinCallingHours } from '@outbound-call/shared';
import { canLaunchCalls } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Ensure RLS helpers see an active role for this Google user.
  // Prefer RPC when present; fall back to a direct upsert (migration may not be applied yet).
  const { error: roleError } = await supabase.rpc('ensure_user_role');
  if (roleError) {
    console.error('[launch] ensure_user_role failed', roleError);
    const { error: upsertError } = await supabase
      .from('case_tracker_user_roles')
      .upsert(
        { user_id: user.id, role: 'staff', active: true },
        { onConflict: 'user_id' },
      );
    if (upsertError) {
      console.error('[launch] role upsert failed', upsertError);
    }
  }

  const permitted = await canLaunchCalls(user.id);
  if (!permitted) {
    return NextResponse.json(
      { error: 'You do not have permission to launch calls' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const {
    caseId,
    destination,
    contextFields,
    instructions,
    callingHoursOverride = false,
    missionType = 'open_insurance_claim',
  } = body;

  if (!caseId || !destination?.phoneNumber || !destination?.organizationName) {
    return NextResponse.json(
      { error: 'Missing required fields' },
      { status: 400 },
    );
  }

  if (!instructions?.goal) {
    return NextResponse.json(
      { error: 'Mission goal is required' },
      { status: 400 },
    );
  }

  const normalizedPhone = normalizePhoneNumber(destination.phoneNumber);
  if (!isValidE164(normalizedPhone)) {
    return NextResponse.json(
      { error: 'Invalid phone number format' },
      { status: 400 },
    );
  }

  const { data: blocked } = await supabase
    .from('blocked_phone_numbers')
    .select('id')
    .eq('phone_number', normalizedPhone)
    .maybeSingle();

  if (blocked) {
    return NextResponse.json(
      { error: 'This phone number is blocked' },
      { status: 400 },
    );
  }

  const { data: voiceSettings } = await supabase
    .from('voice_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (voiceSettings && voiceSettings.is_enabled === false) {
    return NextResponse.json(
      { error: 'AI calling is currently disabled' },
      { status: 400 },
    );
  }

  const voiceMode = process.env.VOICE_MODE ?? process.env.NEXT_PUBLIC_VOICE_MODE ?? 'mock';
  const startTime = voiceSettings?.allowed_call_start_time ?? '09:00';
  const endTime = voiceSettings?.allowed_call_end_time ?? '17:00';
  const destTimezone = destination.destinationTimezone ?? 'America/Chicago';

  // Enforce calling hours only in live mode so mock testing works anytime
  if (
    voiceMode === 'live' &&
    !isWithinCallingHours(destTimezone, startTime, endTime) &&
    callingHoursOverride !== true
  ) {
    return NextResponse.json(
      {
        error: 'Outside allowed calling hours for the destination time zone',
        code: 'OUTSIDE_CALLING_HOURS',
        canOverride: true,
        allowedHours: { startTime, endTime, timezone: destTimezone },
      },
      { status: 409 },
    );
  }

  const approvedContext = (contextFields ?? []).map((f: {
    field: string;
    label: string;
    value: string;
    included: boolean;
    missionSpecificValue?: string;
  }) => ({
    field: f.field,
    label: f.label,
    value: f.missionSpecificValue || f.value,
    included: f.included,
    missionSpecificValue: f.missionSpecificValue,
  }));

  const authorizationSnapshot = {
    authorizedBy: user.id,
    authorizedAt: new Date().toISOString(),
    approvedContext,
    destination: { ...destination, phoneNumber: normalizedPhone },
    voiceMode,
    callingHoursOverride: callingHoursOverride === true,
    callingHoursOverrideAt:
      callingHoursOverride === true ? new Date().toISOString() : null,
  };

  const { data: mission, error: insertError } = await supabase
    .from('call_missions')
    .insert({
      case_id: caseId,
      mission_type: missionType,
      title: `${destination.organizationName} call`,
      organization_name: destination.organizationName,
      department: destination.department || null,
      contact_name: destination.contactName || null,
      destination_phone: normalizedPhone,
      extension: destination.extension || null,
      destination_timezone: destTimezone,
      goal: instructions.goal,
      objectives: instructions.objectives ?? [],
      success_criteria: instructions.successCriteria ?? [],
      approved_context: approvedContext,
      allowed_disclosures: instructions.allowedDisclosures ?? [],
      restricted_topics: instructions.restrictedTopics ?? [],
      escalation_rules: instructions.escalationConditions ?? [],
      authorization_snapshot: authorizationSnapshot,
      status: 'queued',
      created_by: user.id,
      authorized_by: user.id,
      authorized_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError || !mission) {
    console.error('[launch] call_missions insert failed', {
      message: insertError?.message,
      code: insertError?.code,
      details: insertError?.details,
      hint: insertError?.hint,
      caseId,
      userId: user.id,
    });

    return NextResponse.json(
      {
        error: insertError?.message
          ? `Failed to create call mission: ${insertError.message}`
          : 'Failed to create call mission',
        code: insertError?.code,
        details: insertError?.details,
        hint: insertError?.hint,
      },
      { status: 500 },
    );
  }

  const workerUrl = process.env.VOICE_WORKER_BASE_URL;
  const workerSecret = process.env.VOICE_WORKER_INTERNAL_SECRET;

  if (workerUrl && workerSecret) {
    try {
      const workerRes = await fetch(`${workerUrl}/internal/launch-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': workerSecret,
        },
        body: JSON.stringify({ missionId: mission.id }),
      });

      if (!workerRes.ok) {
        const workerBody = await workerRes.text();
        console.error('[launch] voice worker rejected launch', {
          status: workerRes.status,
          body: workerBody,
          missionId: mission.id,
        });
      }
    } catch (err) {
      console.error('[launch] voice worker unreachable', err);
      await supabase
        .from('call_missions')
        .update({ status: 'failed', failure_reason: 'Failed to reach voice worker' })
        .eq('id', mission.id);

      return NextResponse.json(
        { error: 'Failed to communicate with voice worker', missionId: mission.id },
        { status: 502 },
      );
    }
  } else {
    console.warn('[launch] VOICE_WORKER_BASE_URL or VOICE_WORKER_INTERNAL_SECRET not set; mission queued without worker notify');
  }

  return NextResponse.json({ missionId: mission.id, status: 'queued' });
}
