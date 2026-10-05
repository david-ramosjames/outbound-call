'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Play, RefreshCw, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Voice {
  id: string;
  name: string;
  language: string | null;
  custom: boolean;
  description: string | null;
  gender: string | null;
}

const FALLBACK: Voice[] = [
  ['ara', 'Warm and friendly.'],
  ['eve', 'Energetic and upbeat.'],
  ['leo', 'Authoritative and strong.'],
  ['rex', 'Confident and clear.'],
  ['sal', 'Smooth and balanced.'],
].map(([id, description]) => ({
  id: id!,
  name: id![0]!.toUpperCase() + id!.slice(1),
  language: 'en',
  custom: false,
  description: description!,
  gender: null,
}));

/** Voice list backed by the live xAI catalog, with a play button on each voice. */
export function VoicePicker({
  label = 'Voice',
  value,
  onChange,
  sampleText,
  hint,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (voice: string) => void;
  sampleText: string;
  hint?: string;
}) {
  const [voices, setVoices] = useState<Voice[]>(FALLBACK);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [initialValue] = useState(value);

  const load = async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/voices${refresh ? '?refresh=1' : ''}`);
      const data = (await res.json()) as { voices?: Voice[]; live?: boolean; error?: string };
      if (!res.ok || !data.voices?.length) throw new Error(data.error ?? 'Could not load voices');
      setVoices(data.voices);
      setLive(data.live !== false);
    } catch {
      setLive(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => audioRef.current?.pause();
  }, []);

  const stop = () => {
    audioRef.current?.pause();
    setPlaying(null);
  };

  const preview = async (voiceId: string) => {
    if (playing === voiceId) return stop();
    stop();
    setError(null);
    const key = `${voiceId}|${sampleText}`;
    let src = cacheRef.current.get(key);
    if (!src) {
      setLoadingPreview(voiceId);
      try {
        const res = await fetch('/api/voices/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice: voiceId, text: sampleText }),
        });
        const data = (await res.json()) as { audio?: string; mime?: string; error?: string };
        if (!res.ok || !data.audio) throw new Error(data.error ?? 'Preview failed');
        src = `data:${data.mime ?? 'audio/mpeg'};base64,${data.audio}`;
        cacheRef.current.set(key, src);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview failed');
        return;
      } finally {
        setLoadingPreview(null);
      }
    }
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    setPlaying(voiceId);
    await audio.play().catch(() => setPlaying(null));
  };

  const all = voices.some((v) => v.id === value)
    ? voices
    : [{ id: value, name: value, language: null, custom: false, description: null, gender: null }, ...voices];
  // The saved voice stays pinned at the top (selection changes don't reorder the list under the cursor).
  const ordered = [...all].sort(
    (a, b) =>
      Number(b.id === initialValue) - Number(a.id === initialValue) ||
      Number(b.custom) - Number(a.custom) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between max-w-xl">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
          title="Refresh voice list"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
        </button>
      </div>
      <div role="radiogroup" aria-label={label} className="max-w-xl max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
        {ordered.map((v) => {
          const selected = v.id === value;
          const meta = [v.gender, v.description].filter(Boolean).join(', ');
          return (
            <div
              key={v.id}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => onChange(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(v.id);
                }
              }}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-firm-accent',
                selected ? 'bg-navy-50' : 'hover:bg-slate-50',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  selected ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300',
                )}
              >
                {selected && <Check className="h-3 w-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {v.name}
                  {v.custom && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Custom</span>}
                </p>
                {meta && <p className="text-xs text-slate-500 truncate">{meta}</p>}
              </div>
              {v.id === initialValue && <span className="text-xs text-slate-500">Current</span>}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void preview(v.id);
                }}
                disabled={loadingPreview !== null && loadingPreview !== v.id}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                title={playing === v.id ? 'Stop' : `Hear ${v.name}`}
                aria-label={playing === v.id ? 'Stop' : `Hear ${v.name}`}
              >
                {loadingPreview === v.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : playing === v.id ? (
                  <Square className="h-3 w-3 fill-current" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && !live && !loading && (
        <p className="text-xs text-amber-700">Couldn&apos;t reach xAI for the full voice list; showing the classic voices.</p>
      )}
      {!error && hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
