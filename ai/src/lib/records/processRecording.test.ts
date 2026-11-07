import { DEFAULT_AI_SETTINGS, setAiSetting } from '@vtt-chat-app/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Job, Recording, RecordingTrack, Segment } from '../../types/index.js';
import { MemoryJobQueue } from '../jobs/queue.js';
import { buildJobProviders } from '../providers/fromSettings.js';
import { processNext } from '../jobs/worker.js';
import { MemoryRecordsStore } from './memoryRecordsStore.js';
import { createProcessRecordingHandler, PROCESS_RECORDING_JOB } from './processRecording.js';

const REC = 'rec-1';
const recording: Recording = {
  id: REC,
  campaignId: 'camp-1',
  startedAt: 0,
  stoppedAt: 10,
  status: 'stopped',
};
const track = (
  id: string,
  speaker: string,
  extra: Partial<RecordingTrack> = {},
): RecordingTrack => ({
  id,
  recordingId: REC,
  speakerId: speaker,
  speakerName: speaker.toUpperCase(),
  filePath: `/audio/${id}.ogg`,
  startOffsetMs: 0,
  private: false,
  transcribedAt: null,
  ...extra,
});

let records: MemoryRecordsStore;
let transcribed: string[];
let prompts: string[];
const say = (text: string, startMs = 0): Segment[] => [{ startMs, endMs: startMs + 1000, text }];

function handler(overrides: Partial<Parameters<typeof createProcessRecordingHandler>[0]> = {}) {
  return createProcessRecordingHandler({
    records,
    localTranscribe: () => async () => [],
    localGenerate: async (prompt) => {
      prompts.push(prompt);
      return `summary #${prompts.length}`;
    },
    transcribeAudioFile: async (file) => {
      transcribed.push(file);
      return say(`said in ${file}`);
    },
    now: () => 5000,
    ...overrides,
  });
}
const job = (): Job => ({
  id: 'j',
  kind: PROCESS_RECORDING_JOB,
  recordingId: REC,
  state: 'running',
  attempts: 1,
  maxAttempts: 5,
  runAfter: 0,
  lockedUntil: null,
  lastError: null,
  createdAt: 0,
  updatedAt: 0,
});

beforeEach(async () => {
  records = new MemoryRecordsStore();
  transcribed = [];
  prompts = [];
  records.campaigns.set('camp-1', 'Curse of Strahd');
  await records.putRecording({ ...recording });
  await records.putTrack(track('t-alice', 'alice'));
  await records.putTrack(track('t-bob', 'bob', { startOffsetMs: 2000 }));
});

describe('process-recording handler', () => {
  it('transcribes every track, writes both summaries and marks the recording processed', async () => {
    await handler().run(job());
    expect(transcribed.sort()).toEqual(['/audio/t-alice.ogg', '/audio/t-bob.ogg']);
    expect((await records.getRecording(REC))?.status).toBe('processed');
    expect(await records.getSummary(REC, 'session', '')).toMatchObject({ visibility: 'members' });
    expect(await records.getSummary(REC, 'dm-only', '')).toMatchObject({ visibility: 'dm' });
  });

  it('puts the speakers and their track offsets into what the model reads', async () => {
    await handler().run(job());
    expect(prompts[0]).toContain('ALICE');
    expect(prompts[0]).toContain('BOB');
    expect(prompts[0]).toContain('Curse of Strahd');
  });

  it('NEVER transcribes or summarises a private track', async () => {
    await records.putTrack(track('t-whisper', 'carol', { private: true }));
    await handler().run(job());
    expect(transcribed).not.toContain('/audio/t-whisper.ogg');
    expect(prompts.join('\n')).not.toContain('CAROL');
    expect((await records.listTranscripts(REC)).map((t) => t.speaker.id)).not.toContain('carol');
    await expect(records.saveTrackTranscript('t-whisper', say('x'), 1)).rejects.toThrow(/private/);
  });

  it('resumes after a failure without redoing finished work', async () => {
    let calls = 0;
    const flaky = handler({
      transcribeAudioFile: async (file) => {
        transcribed.push(file);
        if (++calls === 2) throw new Error('whisper box fell over');
        return say('ok');
      },
    });
    await expect(flaky.run(job())).rejects.toThrow('fell over');
    expect(transcribed).toHaveLength(2);

    transcribed = [];
    await handler().run(job());
    expect(transcribed).toHaveLength(1); // only the track that had not finished
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });

  it('does not rewrite a summary that already exists', async () => {
    await handler().run(job());
    const calls = prompts.length;
    await handler().run(job());
    expect(prompts).toHaveLength(calls);
  });

  it('records "no speech" without asking a model to invent a summary', async () => {
    const silent = handler({ transcribeAudioFile: async () => [] });
    await silent.run(job());
    expect(prompts).toHaveLength(0);
    expect((await records.getSummary(REC, 'session', ''))?.text).toMatch(/No speech/);
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });

  it('uses the remote backend named in the settings and falls back to local when it is down', async () => {
    records.aiSettings = setAiSetting(
      setAiSetting(
        setAiSetting(DEFAULT_AI_SETTINGS, 'ai.llm.kind', 'remote'),
        'ai.llm.url',
        'http://gpu:11434',
      ),
      'ai.fallback.after-seconds',
      '0',
    );
    const log: string[] = [];
    const h = handler({
      log: (l) => log.push(l),
      // the real builder, with a fetch that always refuses, as a powered-off gaming PC would
      buildProviders: (settings, d) =>
        buildJobProviders(settings, {
          ...d,
          fetchImpl: (async () => {
            throw new TypeError('fetch failed');
          }) as unknown as typeof fetch,
        }),
    });
    await h.run(job());
    expect((await records.getSummary(REC, 'session', ''))?.text).toMatch(/^summary #/);
    expect(log.join('\n')).toContain('fell back to local');
  });

  it('fails clearly for a recording that does not exist', async () => {
    await expect(handler().run({ ...job(), recordingId: 'nope' })).rejects.toThrow(
      /does not exist/,
    );
  });

  it('marks the recording failed when the job gives up', async () => {
    await handler().onGiveUp?.(job(), 'x');
    expect((await records.getRecording(REC))?.status).toBe('failed');
  });
});

describe('through the queue', () => {
  it('a job that fails then succeeds ends processed, with the worker doing the retrying', async () => {
    const queue = new MemoryJobQueue();
    await queue.enqueue({ kind: PROCESS_RECORDING_JOB, recordingId: REC }, 0);
    let fail = true;
    const handlers = {
      [PROCESS_RECORDING_JOB]: handler({
        transcribeAudioFile: async (f) => {
          if (fail) throw new Error('transient');
          return say(f);
        },
      }),
    };
    let t = 1000;
    await processNext({ queue, handlers, now: () => t });
    expect((await queue.list())[0]).toMatchObject({ state: 'queued', attempts: 1 });
    fail = false;
    t += 60_000;
    await processNext({ queue, handlers, now: () => t });
    expect((await queue.list())[0]?.state).toBe('done');
    expect((await records.getRecording(REC))?.status).toBe('processed');
  });
});
