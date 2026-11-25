import type { AiSettings } from '@vtt-chat-app/shared';

import { DEFAULT_CLAUDE_MODEL } from '../consts/claude.js';
import type { JobModels } from '../types/records.js';

/** The local model names, which are the worker's own environment and not a setting (`OLLAMA_MODEL`, `OLLAMA_STORY_MODEL`). */
export interface LocalModelNames {
  llm: string;
  /** The bard's own local model, when it is not the scribe's. */
  story?: string;
}

/**
 * Which models a processing job actually used, for `vtt-admin jobs list` and `status`, so a tale's quality can be traced to
 * the model that wrote it. `fellBack` lists what moved to the local backend because the remote one could not be reached,
 * since then the settings say one thing and the job did another.
 */
export function describeJobModels(
  settings: AiSettings,
  local: LocalModelNames,
  fellBack: readonly ('transcription' | 'llm')[] = [],
): JobModels {
  const transcriptionLocal =
    settings.transcription.kind === 'local' || fellBack.includes('transcription');
  const transcription = transcriptionLocal
    ? 'Whisper (local)'
    : `${settings.transcription.model ?? 'whisper-1'} (remote)`;

  const { llm } = settings;
  const llmLocal = llm.kind === 'local' || fellBack.includes('llm');
  let scribe: string;
  let bard: string;
  if (llmLocal) {
    scribe = `${local.llm} (local)`;
    bard = `${local.story ?? local.llm} (local)`;
  } else if (llm.kind === 'claude') {
    scribe = bard = llm.model ?? DEFAULT_CLAUDE_MODEL;
  } else if (llm.kind === 'openai') {
    scribe = bard = llm.model ?? 'openai';
  } else {
    scribe = bard = `${llm.model ?? 'default'} (remote)`;
  }
  return {
    transcription,
    scribe,
    bard,
    ...(fellBack.length > 0 ? { fellBack: [...fellBack] } : {}),
  };
}
