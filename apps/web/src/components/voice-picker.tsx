'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, Square } from 'lucide-react';

interface Voice {
  id: string;
  name: string;
  language: string | null;
  custom: boolean;
}

const FALLBACK: Voice[] = ['ara', 'eve', 'leo', 'rex', 'sal'].map((id) => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  language: 'en',
  custom: false,
}));

const selectClass =
  'flex h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent';

/** Voice dropdown backed by the live xAI voice list, with a play button to hear a sample. */
export function VoicePicker({
  id = 'voice',
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
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());

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
    setPlaying(false);
  };

  const preview = async () => {
    if (playing) return stop();
    setError(null);
    const key = `${value}|${sampleText}`;
    let src = cacheRef.current.get(key);
    if (!src) {
      setPreviewing(true);
      try {
        const res = await fetch('/api/voices/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ voice: value, text: sampleText }),
        });
        const data = (await res.json()) as { audio?: string; mime?: string; error?: string };
        if (!res.ok || !data.audio) throw new Error(data.error ?? 'Preview failed');
        src = `data:${data.mime ?? 'audio/mpeg'};base64,${data.audio}`;
        cacheRef.current.set(key, src);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview failed');
        return;
      } finally {
        setPreviewing(false);
      }
    }
    audioRef.current?.pause();
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    setPlaying(true);
    await audio.play().catch(() => setPlaying(false));
  };

  const options = voices.some((v) => v.id === value)
    ? voices
    : [{ id: value, name: `${value} (current)`, language: null, custom: false }, ...voices];
  const custom = options.filter((v) => v.custom);
  const builtIn = options.filter((v) => !v.custom);

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex items-center gap-2 max-w-md">
        <select
          id={id}
          className={selectClass}
          value={value}
          onChange={(e) => {
            stop();
            onChange(e.target.value);
          }}
        >
          {custom.length > 0 && (
            <optgroup label="Custom voices">
              {custom.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Built-in voices">
            {builtIn.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </optgroup>
        </select>
        <button
          type="button"
          onClick={preview}
          disabled={previewing || !value}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Hear a sample"
        >
          {previewing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Square className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {playing ? 'Stop' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 disabled:opacity-50"
          title="Refresh voice list"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && !live && !loading && (
        <p className="text-xs text-amber-700">Couldn&apos;t reach xAI for the full voice list; showing the classic voices.</p>
      )}
      {!error && hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
