import type { AiSettings } from '../types/aiSettings.js';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  transcription: { kind: 'local', url: null, model: null, language: 'en' },
  llm: { kind: 'local', url: null, model: null },
  // 10 minutes unreachable before giving up on the remote; retry every 30 s meanwhile.
  fallback: { enabled: true, afterSeconds: 600, retrySeconds: 30 },
};

/** The settable keys, in the dotted form the Admin CLI uses, with what each accepts. */
export const AI_SETTING_KEYS = {
  'ai.transcription.kind': 'local | remote',
  'ai.transcription.url': 'http(s) URL of an OpenAI-compatible server, or "none"',
  'ai.transcription.model': 'model name the remote server expects, or "none"',
  'ai.transcription.language': 'language code such as en',
  'ai.llm.kind': 'local | remote',
  'ai.llm.url': 'http(s) URL of an OpenAI-compatible server, or "none"',
  'ai.llm.model': 'model name, or "none"',
  'ai.fallback.enabled': 'true | false',
  'ai.fallback.after-seconds': 'whole number of seconds, 0 = immediately',
  'ai.fallback.retry-seconds': 'whole number of seconds, at least 1',
} as const;

export type AiSettingKey = keyof typeof AI_SETTING_KEYS;

export const isAiSettingKey = (key: string): key is AiSettingKey => key in AI_SETTING_KEYS;

export class SettingError extends Error {
  override name = 'SettingError';
}

const NONE = new Set(['none', 'null', '']);

function parseUrl(value: string): string | null {
  if (NONE.has(value.trim().toLowerCase())) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SettingError(`"${value}" is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SettingError('the URL must start with http:// or https://');
  }
  // Keep only the server root; the client appends /v1/....
  return url.href.replace(/\/+$/, '');
}

const parseText = (value: string): string | null =>
  NONE.has(value.trim().toLowerCase()) ? null : value.trim();

function parseKind(value: string): 'local' | 'remote' {
  if (value === 'local' || value === 'remote') return value;
  throw new SettingError('must be "local" or "remote"');
}

function parseBool(value: string): boolean {
  if (['true', 'yes', 'on', '1'].includes(value.toLowerCase())) return true;
  if (['false', 'no', 'off', '0'].includes(value.toLowerCase())) return false;
  throw new SettingError('must be true or false');
}

function parseSeconds(value: string, min: number): number {
  if (!/^\d+$/.test(value.trim())) throw new SettingError('must be a whole number of seconds');
  const n = Number(value);
  if (n < min) throw new SettingError(`must be at least ${min}`);
  return n;
}

/**
 * Returns `settings` with one key changed, or throws {@link SettingError}. Never mutates. A remote
 * backend without a URL is rejected by {@link validateAiSettings}, not here, so the URL can be set
 * before or after switching `kind`.
 */
export function setAiSetting(settings: AiSettings, key: AiSettingKey, value: string): AiSettings {
  const next: AiSettings = structuredClone(settings);
  switch (key) {
    case 'ai.transcription.kind':
      next.transcription.kind = parseKind(value);
      break;
    case 'ai.transcription.url':
      next.transcription.url = parseUrl(value);
      break;
    case 'ai.transcription.model':
      next.transcription.model = parseText(value);
      break;
    case 'ai.transcription.language': {
      const language = value.trim().toLowerCase();
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(language) && language !== 'auto') {
        throw new SettingError('must be a language code such as en, or auto');
      }
      next.transcription.language = language;
      break;
    }
    case 'ai.llm.kind':
      next.llm.kind = parseKind(value);
      break;
    case 'ai.llm.url':
      next.llm.url = parseUrl(value);
      break;
    case 'ai.llm.model':
      next.llm.model = parseText(value);
      break;
    case 'ai.fallback.enabled':
      next.fallback.enabled = parseBool(value);
      break;
    case 'ai.fallback.after-seconds':
      next.fallback.afterSeconds = parseSeconds(value, 0);
      break;
    case 'ai.fallback.retry-seconds':
      next.fallback.retrySeconds = parseSeconds(value, 1);
      break;
  }
  return next;
}

/** Problems that make a settings object unusable, as readable sentences. Empty means usable. */
export function validateAiSettings(settings: AiSettings): string[] {
  const problems: string[] = [];
  if (settings.transcription.kind === 'remote' && settings.transcription.url === null) {
    problems.push('transcription is set to remote but has no URL (ai.transcription.url)');
  }
  if (settings.llm.kind === 'remote' && settings.llm.url === null) {
    problems.push('the LLM is set to remote but has no URL (ai.llm.url)');
  }
  return problems;
}

/**
 * Reads stored settings of any age: missing or wrong-typed fields fall back to the defaults, so
 * adding a setting later never breaks an existing database. Unknown fields are dropped.
 */
export function normaliseAiSettings(raw: unknown): AiSettings {
  const d = DEFAULT_AI_SETTINGS;
  const o = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const str = (v: unknown, fallback: string | null): string | null =>
    typeof v === 'string' ? v : v === null ? null : fallback;
  const kind = (v: unknown, fallback: 'local' | 'remote'): 'local' | 'remote' =>
    v === 'local' || v === 'remote' ? v : fallback;
  const int = (v: unknown, fallback: number, min: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= min ? v : fallback;
  const t = o.transcription ?? {};
  const l = o.llm ?? {};
  const f = o.fallback ?? {};
  return {
    transcription: {
      kind: kind(t.kind, d.transcription.kind),
      url: str(t.url, d.transcription.url),
      model: str(t.model, d.transcription.model),
      language: typeof t.language === 'string' ? t.language : d.transcription.language,
    },
    llm: {
      kind: kind(l.kind, d.llm.kind),
      url: str(l.url, d.llm.url),
      model: str(l.model, d.llm.model),
    },
    fallback: {
      enabled: typeof f.enabled === 'boolean' ? f.enabled : d.fallback.enabled,
      afterSeconds: int(f.afterSeconds, d.fallback.afterSeconds, 0),
      retrySeconds: int(f.retrySeconds, d.fallback.retrySeconds, 1),
    },
  };
}
