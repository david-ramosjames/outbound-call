import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const XAI_BASE = 'https://api.x.ai/v1';
const CACHE_MS = 10 * 60 * 1000;
const FALLBACK = ['ara', 'eve', 'leo', 'rex', 'sal'];

/** Published tone descriptions for built-in voices (x.ai/voice/text-to-speech); the list endpoint returns only names. */
const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  ara: 'Warm and friendly.',
  eve: 'Energetic and upbeat.',
  leo: 'Authoritative and strong.',
  rex: 'Confident and clear.',
  sal: 'Smooth and balanced.',
  altair: 'Elegant, refined, and effortlessly premium.',
  atlas: 'Confident, commanding, and reassuring.',
  aurora: 'Serene, steady, and radiant.',
  carina: 'Soft, empathetic, and soothing.',
  castor: 'Charismatic, down-to-earth, and easygoing.',
  celeste: 'Compassionate, confident, and reassuring.',
  cosmo: 'Bright, curious, and easy to follow.',
  helios: 'Upbeat, energetic, and endlessly versatile.',
  helix: 'Bold, dynamic, and adrenaline-fueled.',
  iris: 'Friendly, upbeat, and naturally charming.',
  kepler: 'Inventive, forward-thinking, and charismatic.',
  liora: 'Calm, grounded, and luminous.',
  lumen: 'Warm, articulate, and engaging.',
  luna: 'Gentle, patient, and deeply nurturing.',
  lux: 'Grounded, calm, and quietly wise.',
  naksh: 'Warm, thoughtful, and wise.',
  orion: 'Rich, cinematic, and resonant.',
  perseus: 'Strong, confident, and trustworthy.',
  rigel: 'Precise, professional, and calmly confident.',
  sirius: 'Quick-witted, clever, and playful.',
  ursa: 'Friendly, warm, and steadfast.',
  zagan: 'Powerful, dramatic, and unmistakable.',
  zenith: 'Sharp, focused, and driven.',
};

export interface XaiVoice {
  id: string;
  name: string;
  language: string | null;
  custom: boolean;
  description: string | null;
  gender: string | null;
}

let cache: { at: number; voices: XaiVoice[] } | null = null;

async function xaiGet(path: string): Promise<unknown> {
  const res = await fetch(`${XAI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${config.XAI_API_KEY}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`xAI ${path} returned ${res.status}`);
  return res.json();
}

type RawVoice = { voice_id?: string; name?: string; language?: string | null; description?: string | null; gender?: string | null };

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function toVoices(raw: unknown, custom: boolean): XaiVoice[] {
  const list = (raw as { voices?: RawVoice[] } | null)?.voices ?? [];
  return list
    .filter((v) => typeof v.voice_id === 'string' && v.voice_id.trim())
    .map((v) => {
      const id = v.voice_id!.trim().toLowerCase();
      const gender = v.gender && v.gender !== 'null' ? capitalize(v.gender) : null;
      return {
        id,
        name: v.name?.trim() || v.voice_id!.trim(),
        language: v.language ?? null,
        custom,
        description: v.description?.trim() || (custom ? null : BUILT_IN_DESCRIPTIONS[id] ?? null),
        gender,
      };
    });
}

/** Built-in voices plus this team's custom voices, cached for 10 minutes. Falls back to the five classic voices. */
export async function listXaiVoices(force = false): Promise<{ voices: XaiVoice[]; live: boolean }> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { voices: cache.voices, live: true };
  try {
    const [builtIn, custom] = await Promise.all([
      xaiGet('/tts/voices'),
      xaiGet('/custom-voices').catch(() => null),
    ]);
    const voices = [...toVoices(custom, true), ...toVoices(builtIn, false)];
    const seen = new Set<string>();
    const unique = voices.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
    unique.sort((a, b) => Number(b.custom) - Number(a.custom) || a.name.localeCompare(b.name));
    cache = { at: Date.now(), voices: unique };
    return { voices: unique, live: true };
  } catch (err) {
    logger.warn('Could not list xAI voices; using fallback list', { error: err });
    return {
      voices: FALLBACK.map((id) => ({
        id,
        name: capitalize(id),
        language: 'en',
        custom: false,
        description: BUILT_IN_DESCRIPTIONS[id] ?? null,
        gender: null,
      })),
      live: false,
    };
  }
}

/** Short MP3 sample of a voice, for previewing in the dashboard. */
export async function previewXaiVoice(voiceId: string, text: string): Promise<Buffer> {
  const res = await fetch(`${XAI_BASE}/tts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voiceId, language: 'en' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`xAI TTS returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
