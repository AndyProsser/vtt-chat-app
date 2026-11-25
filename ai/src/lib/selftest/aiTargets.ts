import type { AiSettings, TestRow } from '@vtt-chat-app/shared';

export type AiPart = 'transcription' | 'llm';
export type AiWhere = 'local' | 'remote' | 'cloud';
export interface AiTarget {
  what: AiPart;
  where: AiWhere;
}

/** Which backends `vtt-admin test ai` was asked to try (`--local`, `--remote`, `--cloud`). */
export interface AiTestFlags {
  local: boolean;
  remote: boolean;
  cloud: boolean;
}

const note = (detail: string): TestRow => ({ badge: 'warn', name: 'What was tested', detail });

/**
 * What to test. With no flag: only what is configured, and **never cloud AI**: a cloud test is a real, billable call, so
 * a cloud model that is configured is replaced by a test of the local one, with a note saying how to test the cloud one.
 * With flags: exactly those, and a note when a flag names something that is not configured.
 */
export function aiTargets(
  settings: AiSettings,
  flags: AiTestFlags,
): { targets: AiTarget[]; notes: TestRow[] } {
  const targets: AiTarget[] = [];
  const notes: TestRow[] = [];
  const add = (t: AiTarget): void => {
    if (!targets.some((x) => x.what === t.what && x.where === t.where)) targets.push(t);
  };
  const cloudKind = settings.llm.kind === 'claude' || settings.llm.kind === 'openai';

  if (!flags.local && !flags.remote && !flags.cloud) {
    add({ what: 'transcription', where: settings.transcription.kind });
    if (cloudKind) {
      add({ what: 'llm', where: 'local' });
      notes.push(
        note(
          `Cloud AI (${settings.llm.kind}) is configured but was not tested: a test is a real, billable call (a fraction of a cent). The local model was tested instead; add --cloud to test ${settings.llm.kind}.`,
        ),
      );
    } else {
      add({ what: 'llm', where: settings.llm.kind as AiWhere });
    }
    return { targets, notes };
  }

  if (flags.local) {
    add({ what: 'transcription', where: 'local' });
    add({ what: 'llm', where: 'local' });
  }
  if (flags.remote) {
    const before = targets.length;
    if (settings.transcription.kind === 'remote') add({ what: 'transcription', where: 'remote' });
    if (settings.llm.kind === 'remote') add({ what: 'llm', where: 'remote' });
    if (targets.length === before && !targets.some((t) => t.where === 'remote')) {
      notes.push(
        note(
          '--remote: nothing remote is configured (ai.transcription.kind and ai.llm.kind are not "remote"). Set one with vtt-admin settings set.',
        ),
      );
    }
  }
  if (flags.cloud) {
    if (cloudKind) add({ what: 'llm', where: 'cloud' });
    else {
      notes.push(
        note(
          `--cloud: no cloud AI is configured (ai.llm.kind is ${settings.llm.kind}). Set it to claude or openai first.`,
        ),
      );
    }
  }
  return { targets, notes };
}
