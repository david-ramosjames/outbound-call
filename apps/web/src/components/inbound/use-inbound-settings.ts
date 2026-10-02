'use client';

import { useCallback, useEffect, useState } from 'react';
import { resolveInboundConfig, type InboundConfig } from '@outbound-call/shared';
import { createClient } from '@/lib/supabase/client';

export type SettingsSection = keyof InboundConfig;

export function useInboundSettings() {
  const [config, setConfig] = useState<InboundConfig>(() => resolveInboundConfig({}));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SettingsSection | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.from('inbound_settings').select('*').eq('id', 1).maybeSingle();
    if (error) setLoadError(`Could not load inbound settings (${error.message}). Has the inbound migration been run?`);
    setConfig(resolveInboundConfig(data));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async <S extends SettingsSection>(section: S, value: InboundConfig[S]) => {
    setSaving(section);
    setMessage(null);
    const res = await fetch('/api/inbound/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, value }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(null);
    if (!res.ok) {
      const detail = Array.isArray(body.details) ? `: ${body.details.map((d: { path: string[]; message: string }) => `${d.path.join('.')} ${d.message}`).join('; ')}` : '';
      setMessage({ kind: 'error', text: `${body.error ?? 'Save failed'}${detail}` });
      return false;
    }
    setConfig((c) => ({ ...c, [section]: body.value }));
    setMessage({ kind: 'ok', text: 'Saved.' });
    setTimeout(() => setMessage(null), 3000);
    return true;
  }, []);

  return { config, setConfig, loading, loadError, saving, message, save };
}
