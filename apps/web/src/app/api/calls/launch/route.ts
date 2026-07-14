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

  const permitted = await canLaunchCalls(user.id);
  if (!permitted) {
    return NextResponse.json(
      { error: 'You do not have permission to launch calls' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const { caseId, destination, contextFields, instructions } = body;

  if (!caseId || !destination?.phoneNumber || !destination?.organizationName) {
    return NextResponse.json(
      { error: 'Missing required fields' },
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
    .single();

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
    .single();

  if (voiceSettings && !voiceSettings.is_enabled) {
    return NextResponse.json(
      { error: 'AI calling is currently disabled' },
      { status: 400 },
    );
  }

  const startTime = voiceSettings?.allowed_call_start_time ?? '09:00';
  const endTime = voiceSettings?.allowed_call_end_time ?? '17:00';
  const destTimezone = destination.destinationTimezone ?? 'America/Chicago';

  if (!isWithinCallingHours(destTimezone, startTime, endTime)) {
    return NextResponse.json(
      { error: 'Outside allowed calling hours for the destination time zone' },
      { status: 400 },
    );
  }

  const approvedContext = (contextFields ?? []).map((f: { field: string; label: string; value: string; included: boolean; missionSpecificValue?: string }) => ({
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
    voiceMode: process.env.VOICE_MODE ?? 'mock',
  };

  const { data: mission, error: insertError } = await supabase
    .from('call_missions')
    .insert({
      case_id: caseId,
      mission_type: 'open_insurance_claim',
      title: `Open Claim - ${destination.organizationName}`,
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
    return NextResponse.json(
      { error: 'Failed to create call mission' },
      { status: 500 },
    );
  }

  const workerUrl = process.env.VOICE_WORKER_BASE_URL;
  const workerSecret = process.env.VOICE_WORKER_INTERNAL_SECRET;

  if (workerUrl && workerSecret) {
    try {
      await fetch(`${workerUrl}/internal/launch-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': workerSecret,
        },
        body: JSON.stringify({ missionId: mission.id }),
      });
    } catch (err) {
      await supabase
        .from('call_missions')
        .update({ status: 'failed', failure_reason: 'Failed to reach voice worker' })
        .eq('id', mission.id);

      return NextResponse.json(
        { error: 'Failed to communicate with voice worker', missionId: mission.id },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ missionId: mission.id, status: 'queued' });
}
