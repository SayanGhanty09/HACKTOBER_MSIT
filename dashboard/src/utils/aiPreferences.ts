export type AIFeatureMode = 'liveRecording' | 'regionalAnalytics' | 'assistantChat';

const OPENROUTER_KEY_STORAGE = 'spectru_openrouter_key';
const OPENROUTER_MODELS_STORAGE = 'spectru_openrouter_models';

export const DEFAULT_OPENROUTER_KEY = '';

const DEFAULT_MODELS: Record<AIFeatureMode, string> = {
  liveRecording: 'openai/gpt-4o-mini',
  regionalAnalytics: 'openai/gpt-4o-mini',
  assistantChat: 'openai/gpt-4o-mini',
};

export const AI_MODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'openai/gpt-4o-mini', label: 'Gemini 3.8 High' },
];

const ALLOWED_MODELS = new Set(AI_MODE_OPTIONS.map((option) => option.value));

type StoredModels = Partial<Record<AIFeatureMode, string>>;

function readStoredModels(): StoredModels {
  try {
    const raw = localStorage.getItem(OPENROUTER_MODELS_STORAGE);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as StoredModels;
    if (typeof parsed !== 'object' || parsed === null) return {};

    let modified = false;
    for (const key of Object.keys(parsed) as AIFeatureMode[]) {
      const val = parsed[key];
      if (
        !val ||
        !ALLOWED_MODELS.has(val) ||
        val.includes('claude-3.5-haiku') ||
        val.includes('gemma') ||
        val === 'openrouter/free'
      ) {
        parsed[key] = DEFAULT_MODELS[key];
        modified = true;
      }
    }
    if (modified) {
      localStorage.setItem(OPENROUTER_MODELS_STORAGE, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStoredModels(models: StoredModels): void {
  localStorage.setItem(OPENROUTER_MODELS_STORAGE, JSON.stringify(models));
}

export function getOpenRouterKey(): string {
  const stored = localStorage.getItem(OPENROUTER_KEY_STORAGE);
  if (stored && stored.trim()) {
    const trimmed = stored.trim();
    // Auto-migrate if stored key is the old invalid key or missing sk-or-v1- prefix
    if (trimmed.startsWith('sk-020e') || !trimmed.startsWith('sk-or-v1-')) {
      localStorage.setItem(OPENROUTER_KEY_STORAGE, DEFAULT_OPENROUTER_KEY);
      return DEFAULT_OPENROUTER_KEY;
    }
    return trimmed;
  }
  const envKey = ((import.meta.env.VITE_OPENROUTER_API_KEY || import.meta.env.VITE_OPENROUTER_KEY) as string | undefined) || '';
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }
  return DEFAULT_OPENROUTER_KEY;
}

export function setOpenRouterKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    localStorage.removeItem(OPENROUTER_KEY_STORAGE);
  } else {
    localStorage.setItem(OPENROUTER_KEY_STORAGE, trimmed);
  }
}

export interface KeyTestResult {
  valid: boolean;
  message: string;
  details?: {
    label?: string;
    usage?: number;
    limit?: number | null;
    is_free_tier?: boolean;
  };
}

export async function testOpenRouterKey(keyToTest?: string): Promise<KeyTestResult> {
  const key = (keyToTest !== undefined ? keyToTest : getOpenRouterKey()).trim();
  if (!key) {
    return { valid: false, message: 'No API key provided. Please enter a key from openrouter.ai/keys.' };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (response.ok) {
      const json = await response.json();
      const data = json?.data;
      const label = data?.label ? ` ("${data.label}")` : '';
      return {
        valid: true,
        message: `Key is valid and active${label}!`,
        details: data,
      };
    }

    const errJson = await response.json().catch(() => ({}));
    const rawMsg = (errJson as { error?: { message?: string } })?.error?.message;
    if (response.status === 401) {
      return {
        valid: false,
        message: `Authentication failed (401): ${rawMsg || 'User not found / Invalid API key'}. Please check for typos or generate a fresh key at openrouter.ai/keys.`,
      };
    }

    return {
      valid: false,
      message: `OpenRouter returned HTTP ${response.status}: ${rawMsg || response.statusText}`,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      message: `Connection error testing key: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function getOpenRouterModel(_mode?: AIFeatureMode): string {
  return 'openai/gpt-4o-mini';
}

export function setOpenRouterModel(mode: AIFeatureMode, model: string): void {
  const models = readStoredModels();
  models[mode] = model;
  writeStoredModels(models);
}

export function getAIModeLabel(mode: AIFeatureMode): string {
  switch (mode) {
    case 'liveRecording':
      return 'Live Recording';
    case 'regionalAnalytics':
      return 'Regional Analytics';
    case 'assistantChat':
      return 'AI Assistant Chat';
  }
}