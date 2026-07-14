'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { DEFAULT_VOICE_SETTINGS } from '@outbound-call/shared';

interface VoiceSettingsData {
  id?: string;
  ai_disclosure_text: string;
  recording_disclosure_text: string;
  recording_enabled: boolean;
  allowed_call_start_time: string;
  allowed_call_end_time: string;
  maximum_call_duration_seconds: number;
  maximum_hold_duration_seconds: number;
  default_voice: string;
  is_enabled: boolean;
}

export default function VoiceSettingsPage() {
  const [settings, setSettings] = useState<VoiceSettingsData>({
    ai_disclosure_text: DEFAULT_VOICE_SETTINGS.aiDisclosureText,
    recording_disclosure_text: DEFAULT_VOICE_SETTINGS.recordingDisclosureText,
    recording_enabled: DEFAULT_VOICE_SETTINGS.recordingEnabled,
    allowed_call_start_time: DEFAULT_VOICE_SETTINGS.allowedCallStartTime,
    allowed_call_end_time: DEFAULT_VOICE_SETTINGS.allowedCallEndTime,
    maximum_call_duration_seconds: DEFAULT_VOICE_SETTINGS.maximumCallDurationSeconds,
    maximum_hold_duration_seconds: DEFAULT_VOICE_SETTINGS.maximumHoldDurationSeconds,
    default_voice: DEFAULT_VOICE_SETTINGS.defaultVoice,
    is_enabled: DEFAULT_VOICE_SETTINGS.isEnabled,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadSettings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('voice_settings')
      .select('*')
      .limit(1)
      .single();

    if (data) {
      setSettings(data as VoiceSettingsData);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();

    if (settings.id) {
      await supabase
        .from('voice_settings')
        .update({
          ai_disclosure_text: settings.ai_disclosure_text,
          recording_disclosure_text: settings.recording_disclosure_text,
          recording_enabled: settings.recording_enabled,
          allowed_call_start_time: settings.allowed_call_start_time,
          allowed_call_end_time: settings.allowed_call_end_time,
          maximum_call_duration_seconds: settings.maximum_call_duration_seconds,
          maximum_hold_duration_seconds: settings.maximum_hold_duration_seconds,
          default_voice: settings.default_voice,
          is_enabled: settings.is_enabled,
        })
        .eq('id', settings.id);
    } else {
      await supabase.from('voice_settings').insert({
        ai_disclosure_text: settings.ai_disclosure_text,
        recording_disclosure_text: settings.recording_disclosure_text,
        recording_enabled: settings.recording_enabled,
        allowed_call_start_time: settings.allowed_call_start_time,
        allowed_call_end_time: settings.allowed_call_end_time,
        maximum_call_duration_seconds: settings.maximum_call_duration_seconds,
        maximum_hold_duration_seconds: settings.maximum_hold_duration_seconds,
        default_voice: settings.default_voice,
        is_enabled: settings.is_enabled,
      });
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-navy-200 border-t-navy-700 rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Voice Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure AI outbound calling behavior and compliance settings.
        </p>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex gap-3">
          <Shield className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">
              Legal Compliance Warning
            </p>
            <p className="text-xs text-red-700 mt-1">
              These settings affect how AI calls are conducted. Changes may have legal
              implications. Ensure all settings comply with applicable federal, state,
              and local regulations. Consult with your compliance team before making changes.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={settings.is_enabled}
            onChange={(v) => setSettings((s) => ({ ...s, is_enabled: v }))}
            label="AI Calling Enabled"
            description="When disabled, no AI calls can be initiated."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Disclosure</CardTitle>
          <CardDescription>
            The opening statement used by the AI agent to identify itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            id="aiDisclosure"
            label="AI Disclosure Text"
            value={settings.ai_disclosure_text}
            onChange={(e) =>
              setSettings((s) => ({ ...s, ai_disclosure_text: e.target.value }))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording</CardTitle>
          <CardDescription>
            Call recording settings. Recording requires additional legal compliance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Recording is disabled by default. Enabling recording may require
              additional consent disclosures depending on jurisdiction.
            </p>
          </div>
          <Toggle
            checked={settings.recording_enabled}
            onChange={(v) => setSettings((s) => ({ ...s, recording_enabled: v }))}
            label="Recording Enabled"
            description="Record AI outbound calls for quality assurance."
          />
          {settings.recording_enabled && (
            <Textarea
              id="recordingDisclosure"
              label="Recording Disclosure Text"
              value={settings.recording_disclosure_text}
              onChange={(e) =>
                setSettings((s) => ({ ...s, recording_disclosure_text: e.target.value }))
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calling Hours</CardTitle>
          <CardDescription>
            Time window during which AI calls are allowed (in the destination&apos;s time zone).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="startTime"
              label="Start Time"
              type="time"
              value={settings.allowed_call_start_time}
              onChange={(e) =>
                setSettings((s) => ({ ...s, allowed_call_start_time: e.target.value }))
              }
            />
            <Input
              id="endTime"
              label="End Time"
              type="time"
              value={settings.allowed_call_end_time}
              onChange={(e) =>
                setSettings((s) => ({ ...s, allowed_call_end_time: e.target.value }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Duration Limits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="maxDuration"
              label="Max Call Duration (seconds)"
              type="number"
              min={60}
              max={7200}
              value={settings.maximum_call_duration_seconds}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maximum_call_duration_seconds: parseInt(e.target.value) || 1800,
                }))
              }
              hint={`${Math.round(settings.maximum_call_duration_seconds / 60)} minutes`}
            />
            <Input
              id="maxHold"
              label="Max Hold Duration (seconds)"
              type="number"
              min={30}
              max={3600}
              value={settings.maximum_hold_duration_seconds}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maximum_hold_duration_seconds: parseInt(e.target.value) || 600,
                }))
              }
              hint={`${Math.round(settings.maximum_hold_duration_seconds / 60)} minutes`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <label htmlFor="voice" className="block text-sm font-medium text-slate-700">
              Default Voice
            </label>
            <select
              id="voice"
              value={settings.default_voice}
              onChange={(e) =>
                setSettings((s) => ({ ...s, default_voice: e.target.value }))
              }
              className="flex h-10 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
            >
              <option value="alloy">Alloy</option>
              <option value="echo">Echo</option>
              <option value="fable">Fable</option>
              <option value="onyx">Onyx</option>
              <option value="nova">Nova</option>
              <option value="shimmer">Shimmer</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 pt-4">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 font-medium">
            Settings saved successfully.
          </span>
        )}
      </div>
    </div>
  );
}
