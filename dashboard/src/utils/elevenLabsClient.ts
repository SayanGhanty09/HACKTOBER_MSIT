/**
 * ElevenLabs Text-to-Speech Client
 *
 * High-fidelity neural voice synthesis for clinical screening summaries,
 * multimodal ECG assessments, and AI assistant conversations.
 * Includes automatic fallback to browser SpeechSynthesis if the API key
 * has restricted scopes or runs into rate limits.
 */

const ELEVENLABS_KEY_STORAGE = 'anebilin_elevenlabs_key';
const ELEVENLABS_VOICE_STORAGE = 'anebilin_elevenlabs_voice';
const DEFAULT_FALLBACK_KEY = '';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

export interface ElevenLabsVoice {
  id: string;
  name: string;
  description: string;
  previewText: string;
}

export interface ElevenLabsKeyValidationResult {
  valid: boolean;
  message: string;
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    description: 'Calm, Professional (Medical Default)',
    previewText: 'Hello, your cardiac rhythm assessment is ready.',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    description: 'Deep, Confident Male',
    previewText: 'Normal sinus rhythm detected with stable intervals.',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    description: 'Warm, Balanced Clinical Voice',
    previewText: 'Reviewing your screening metrics and waveform morphology.',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    description: 'Clear, Friendly Female',
    previewText: 'Biometric vitals have been successfully analyzed.',
  },
  {
    id: 'N2lVS1w4EtoT3dr4eOWW',
    name: 'Callum',
    description: 'Authoritative, Focused',
    previewText: 'Screening evaluation complete.',
  },
];

export function getElevenLabsKey(): string {
  const stored = localStorage.getItem(ELEVENLABS_KEY_STORAGE);
  if (stored && stored.trim()) return stored.trim();

  const envKey = (import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined) || DEFAULT_FALLBACK_KEY;
  return envKey.trim();
}

export function setElevenLabsKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    localStorage.removeItem(ELEVENLABS_KEY_STORAGE);
  } else {
    localStorage.setItem(ELEVENLABS_KEY_STORAGE, trimmed);
  }
}

export function getSelectedVoiceId(): string {
  const stored = localStorage.getItem(ELEVENLABS_VOICE_STORAGE);
  if (stored && stored.trim()) return stored.trim();
  return DEFAULT_VOICE_ID;
}

export function setSelectedVoiceId(voiceId: string): void {
  localStorage.setItem(ELEVENLABS_VOICE_STORAGE, voiceId);
}

// ── Text Sanitizer ────────────────────────────────────────────────────────────

export function cleanTextForSpeech(text: string): string {
  return text
    // Remove markdown code fences and inline code
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown headers
    .replace(/#{1,6}\s+/g, '')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove bold/italics
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // Replace bullet points with pauses
    .replace(/^[-*•]\s+/gm, '')
    // Replace technical symbols
    .replace(/SpO[2₂]/gi, 'S P O 2')
    .replace(/BPM/gi, 'B P M')
    .replace(/QRS/gi, 'Q R S')
    .replace(/ECG/gi, 'E C G')
    .replace(/HRV/gi, 'H R V')
    .replace(/AFib/gi, 'Atrial Fibrillation')
    .replace(/PVC/gi, 'P V C')
    .replace(/ms\b/gi, 'milliseconds')
    .replace(/sec\b/gi, 'seconds')
    .replace(/~/g, 'approximately ')
    // Remove emojis
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    // Collapse excess whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Playback State ────────────────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let isCurrentlySpeaking = false;
let activeListeners: Array<(speaking: boolean) => void> = [];

export function subscribeSpeechState(listener: (speaking: boolean) => void): () => void {
  activeListeners.push(listener);
  listener(isCurrentlySpeaking);
  return () => {
    activeListeners = activeListeners.filter((l) => l !== listener);
  };
}

function notifyState(speaking: boolean) {
  isCurrentlySpeaking = speaking;
  activeListeners.forEach((l) => l(speaking));
}

export function stopSpeech(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.src = '';
    } catch (_) {}
    currentAudio = null;
  }

  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      if (currentUtterance) {
        currentUtterance.onend = null;
        currentUtterance.onerror = null;
      }
      window.speechSynthesis.cancel();
    } catch (_) {}
    currentUtterance = null;
  }

  notifyState(false);
}

export function isSpeechActive(): boolean {
  return isCurrentlySpeaking;
}

export interface SpeakOptions {
  voiceId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  lang?: string;
}

/**
 * Synthesize and speak text via ElevenLabs API with seamless Web Speech fallback
 */
export async function speakText(
  rawText: string,
  options?: SpeakOptions
): Promise<void> {
  const clean = cleanTextForSpeech(rawText);
  if (!clean) return;

  // Stop any active speech
  stopSpeech();
  notifyState(true);
  options?.onStart?.();

  const apiKey = getElevenLabsKey();
  const voiceId = options?.voiceId || getSelectedVoiceId();

  // Helper for browser SpeechSynthesis fallback
  const fallbackToBrowserSpeech = (reason: string) => {
    console.info(`[ElevenLabsTTS] Falling back to browser speech engine: ${reason}`);
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      notifyState(false);
      options?.onError?.(reason);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.lang = options?.lang || 'en-US';

      // Pick a good browser voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')) && v.lang.startsWith('en')
      ) || voices.find((v) => v.lang.startsWith('en'));
      if (preferred) u.voice = preferred;

      u.onend = () => {
        currentUtterance = null;
        notifyState(false);
        options?.onEnd?.();
      };
      u.onerror = (e) => {
        currentUtterance = null;
        notifyState(false);
        options?.onError?.(e.error || 'Speech error');
      };

      currentUtterance = u;
      window.speechSynthesis.speak(u);
    } catch (err: unknown) {
      notifyState(false);
      options?.onError?.(err instanceof Error ? err.message : String(err));
    }
  };

  // If no ElevenLabs API key, use browser speech immediately
  if (!apiKey) {
    fallbackToBrowserSpeech('No ElevenLabs API key');
    return;
  }

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: clean,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const msg = errJson?.detail?.message || `HTTP ${res.status}`;
      fallbackToBrowserSpeech(`ElevenLabs API (${msg})`);
      return;
    }

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      notifyState(false);
      options?.onEnd?.();
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      fallbackToBrowserSpeech('Audio playback failed');
    };

    await audio.play();
  } catch (err: unknown) {
    fallbackToBrowserSpeech(err instanceof Error ? err.message : 'Network error');
  }
}

export async function testElevenLabsKey(customKey?: string): Promise<ElevenLabsKeyValidationResult> {
  const key = customKey !== undefined ? customKey.trim() : getElevenLabsKey();
  if (!key) {
    return {
      valid: false,
      message: 'No ElevenLabs API key provided. Browser speech synthesis will be used as fallback.',
    };
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: {
        'xi-api-key': key,
      },
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const tier = data?.subscription?.tier || 'active';
      return {
        valid: true,
        message: `ElevenLabs API key is active (${tier} tier). Neural voice synthesis enabled!`,
      };
    }

    const err = await res.json().catch(() => ({}));
    const detailMsg = err?.detail?.message || `HTTP ${res.status}`;
    return {
      valid: false,
      message: `ElevenLabs notice: ${detailMsg}. Web speech synthesis fallback will handle voice playback seamlessly.`,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      message: `Connection error: ${err instanceof Error ? err.message : String(err)}. Web speech synthesis active.`,
    };
  }
}

