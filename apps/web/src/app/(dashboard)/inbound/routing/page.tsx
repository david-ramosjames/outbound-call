'use client';

import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { getBusinessStatus, WEEKDAYS, type Weekday } from '@outbound-call/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { InboundPageHeader, LoadingSpinner, SaveMessage, WarningBox, selectClass } from '@/components/inbound/page-header';
import { useInboundSettings } from '@/components/inbound/use-inbound-settings';
import { LinePicker, useInboundLine } from '@/components/inbound/line-context';
import { VoiceModelSettings } from '@/components/voice-picker';

const DAY_LABELS: Record<Weekday, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const TIMEZONES = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles'];
export default function RoutingAndHoursPage() {
  const { config, setConfig, loading, loadError, saving, message, save } = useInboundSettings();
  const { lineId } = useInboundLine();
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const bh = config.business_hours;
  const r = config.routing;
  const s = config.slack;
  const status = useMemo(() => {
    try {
      return getBusinessStatus(bh);
    } catch {
      return null;
    }
  }, [bh]);

  if (loading) return <LoadingSpinner />;

  const setBh = (patch: Partial<typeof bh>) => setConfig((c) => ({ ...c, business_hours: { ...c.business_hours, ...patch } }));
  const setRouting = (patch: Partial<typeof r>) => setConfig((c) => ({ ...c, routing: { ...c.routing, ...patch } }));
  const setSlack = (patch: Partial<typeof s>) => setConfig((c) => ({ ...c, slack: { ...c.slack, ...patch } }));
  const setDay = (day: Weekday, open: boolean, start?: string, end?: string) => {
    const current = bh.weekly[day][0] ?? { start: '08:00', end: '17:00' };
    setBh({ weekly: { ...bh.weekly, [day]: open ? [{ start: start ?? current.start, end: end ?? current.end }] : [] } });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <InboundPageHeader title="Voice, Routing & Hours" description="The AI's voice, when the team is available, where transfers go, and what happens when the AI is off." />
      <LinePicker />
      {loadError && <WarningBox>{loadError}</WarningBox>}

      <Card>
        <CardHeader>
          <CardTitle>AI Model &amp; Voice</CardTitle>
          <CardDescription>Which AI answers this intake line and the voice callers hear. Press play to hear a voice before saving.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <VoiceModelSettings
            key={lineId ?? 'default'}
            provider={r.voice_provider}
            onProviderChange={(voice_provider) => setRouting({ voice_provider })}
            xaiVoice={r.voice}
            onXaiVoiceChange={(voice) => setRouting({ voice })}
            openaiVoice={r.openai_voice}
            onOpenaiVoiceChange={(openai_voice) => setRouting({ openai_voice })}
            sampleText={`Thank you for calling ${config.firm_name}. My name is Ana, I'm the firm's AI intake assistant. How can I help you today?`}
            hint="The Test Agent uses the same model as the line."
          />
          <Button onClick={() => save('routing', r)} disabled={saving === 'routing'}>
            <Save className="h-4 w-4 mr-1.5" /> {saving === 'routing' ? 'Saving...' : 'Save model & voice'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business Hours</CardTitle>
          <CardDescription>
            {status
              ? <>Right now: <strong className="capitalize">{status.status.replace('_', ' ')}</strong> ({status.localTime}){status.nextOpenPhrase ? `. Opens ${status.nextOpenPhrase}.` : ''}</>
              : 'Times are in the firm’s time zone.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-72">
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="tz">Time zone</label>
            <select id="tz" className={selectClass} value={bh.timezone} onChange={(e) => setBh({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            {WEEKDAYS.map((day) => {
              const range = bh.weekly[day][0];
              return (
                <div key={day} className="flex items-center gap-4">
                  <span className="w-28 text-sm font-medium text-slate-700">{DAY_LABELS[day]}</span>
                  <Toggle checked={Boolean(range)} onChange={(v) => setDay(day, v)} />
                  {range ? (
                    <>
                      <input type="time" className={`${selectClass} w-36`} value={range.start} onChange={(e) => setDay(day, true, e.target.value, range.end)} />
                      <span className="text-slate-400">to</span>
                      <input type="time" className={`${selectClass} w-36`} value={range.end} onChange={(e) => setDay(day, true, range.start, e.target.value)} />
                    </>
                  ) : (
                    <span className="text-sm text-slate-400">Closed</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <p className="text-sm font-medium text-slate-700">Holidays (office closed all day)</p>
            {bh.holidays.map((h, i) => (
              <div key={`${h.date}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="font-mono w-28">{h.date}</span>
                <span className="flex-1">{h.name}</span>
                <button type="button" className="p-1 text-slate-400 hover:text-red-600" onClick={() => setBh({ holidays: bh.holidays.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input type="date" className={`${selectClass} w-44`} value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
              <input className={`${selectClass} w-64`} placeholder="Holiday name" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              <Button
                size="sm"
                variant="outline"
                disabled={!holidayDate || !holidayName.trim()}
                onClick={() => {
                  setBh({ holidays: [...bh.holidays, { date: holidayDate, name: holidayName.trim() }].sort((a, b) => a.date.localeCompare(b.date)) });
                  setHolidayDate('');
                  setHolidayName('');
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={() => save('business_hours', bh)} disabled={saving === 'business_hours'}>
              <Save className="h-4 w-4 mr-1.5" /> {saving === 'business_hours' ? 'Saving...' : 'Save hours'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transfers</CardTitle>
          <CardDescription>
            Numbers in E.164 format (e.g. +15125550100). Live transfers also require the &ldquo;Human transfer&rdquo; flag in Settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input id="primary" label="Primary transfer number" value={r.primary_transfer_number} onChange={(e) => setRouting({ primary_transfer_number: e.target.value })} />
            <Input id="backup" label="Backup transfer number" value={r.backup_transfer_number} onChange={(e) => setRouting({ backup_transfer_number: e.target.value })} />
            <Input id="existing" label="Existing-client line" value={r.existing_client_transfer_number} onChange={(e) => setRouting({ existing_client_transfer_number: e.target.value })} hint="Optional; falls back to primary" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="timeout"
              type="number"
              min={5}
              max={120}
              label="Ring timeout (seconds)"
              value={r.transfer_timeout_seconds}
              onChange={(e) => setRouting({ transfer_timeout_seconds: parseInt(e.target.value) || 25 })}
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle checked={r.business_hours_transfer_enabled} onChange={(v) => setRouting({ business_hours_transfer_enabled: v })} label="Transfer during business hours" />
            <Toggle checked={r.after_hours_transfer_enabled} onChange={(v) => setRouting({ after_hours_transfer_enabled: v })} label="Transfer after hours" description="Only if someone is actually on call" />
          </div>
          <p className="text-xs text-slate-500">
            If the primary number doesn&apos;t answer, the backup is tried. If nobody answers, the caller goes back to the AI, which apologizes, marks an urgent callback, and keeps collecting information.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When the AI Is Off or Unavailable</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-80">
            <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="disabled-behavior">Behavior</label>
            <select id="disabled-behavior" className={selectClass} value={r.disabled_behavior} onChange={(e) => setRouting({ disabled_behavior: e.target.value as typeof r.disabled_behavior })}>
              <option value="forward_to_primary">Forward to the primary transfer number</option>
              <option value="message">Play a message</option>
            </select>
          </div>
          <Textarea id="disabled-message" label="Message" rows={2} className="min-h-0" value={r.disabled_message} onChange={(e) => setRouting({ disabled_message: e.target.value })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Call Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input id="sms-from" label="SMS from-number" value={r.sms_from_number} onChange={(e) => setRouting({ sms_from_number: e.target.value })} hint="Blank = the AI intake number" />
            <Input
              id="max-call"
              type="number"
              min={60}
              max={7200}
              label="Max call length (seconds)"
              value={r.max_call_seconds}
              onChange={(e) => setRouting({ max_call_seconds: parseInt(e.target.value) || 1800 })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slack</CardTitle>
          <CardDescription>
            Post every finished call on this line (summary, then the transcript as replies) to the firm&apos;s lead calls channel. Needs SLACK_BOT_TOKEN on the worker, with the bot invited to the channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle checked={s.enabled} onChange={(v) => setSlack({ enabled: v })} label="Post calls to Slack" />
          <div className="w-80">
            <Input id="slack-channel" label="Channel ID" placeholder="C0123ABCD" value={s.channel_id} onChange={(e) => setSlack({ channel_id: e.target.value.trim() })} hint="In Slack: open the channel → name → About → Channel ID" />
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle
              checked={s.thread_by_phone}
              onChange={(v) => setSlack({ thread_by_phone: v })}
              label="Reply in the caller's existing thread"
              description="If a post with the caller's phone number is in the channel from the last 7 days (e.g. from the Quo router), the call is posted in that thread"
            />
            <Toggle checked={s.include_transcript} onChange={(v) => setSlack({ include_transcript: v })} label="Include the full transcript" />
          </div>
          <Button onClick={() => save('slack', s)} disabled={saving === 'slack'}>
            <Save className="h-4 w-4 mr-1.5" /> {saving === 'slack' ? 'Saving...' : 'Save Slack'}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 sticky bottom-0 bg-slate-50/90 backdrop-blur py-3">
        <Button onClick={() => save('routing', r)} disabled={saving === 'routing'}>
          <Save className="h-4 w-4 mr-1.5" /> {saving === 'routing' ? 'Saving...' : 'Save routing'}
        </Button>
        <SaveMessage message={message} />
      </div>
    </div>
  );
}
