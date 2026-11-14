import { MemoryJobQueue, MemoryRecordsStore, PROCESS_RECORDING_JOB } from '@vtt-chat-app/ai';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryAckStore } from './ackStore.js';
import {
  RecordingCapture,
  type CaptureDeps,
  type EgressResult,
  type OrphanEgress,
  type RecorderTrack,
  type TrackRecorder,
} from './capture.js';
import { orphanOfPath } from './liveKitRecorder.js';

const CAMPAIGN = 'camp-1';
const REC = 'rec-1';

/** A LiveKit stand-in: you decide who is publishing; starting an egress "writes" a file. */
class FakeRecorder implements TrackRecorder {
  tracks: RecorderTrack[] = [];
  started: { egressId: string; trackSid: string; filepath: string; at: number }[] = [];
  results = new Map<string, EgressResult>();
  failListing = false;
  failEgress = new Set<string>();
  n = 0;
  constructor(private readonly clock: () => number) {}

  async listAudioTracks(): Promise<RecorderTrack[]> {
    if (this.failListing) throw new Error('livekit unreachable');
    return [...this.tracks];
  }
  async start(_room: string, trackSid: string, filepath: string): Promise<string> {
    const egressId = `eg-${++this.n}`;
    this.started.push({ egressId, trackSid, filepath, at: this.clock() });
    this.results.set(egressId, { state: 'active' });
    return egressId;
  }
  async stop(egressId: string): Promise<void> {
    this.finish(egressId);
  }
  /** The speaker left: the egress ends by itself. */
  finish(egressId: string): void {
    const s = this.started.find((x) => x.egressId === egressId);
    if (!s) return;
    this.results.set(
      egressId,
      this.failEgress.has(s.trackSid)
        ? { state: 'failed', error: 'disk full' }
        : {
            state: 'complete',
            file: s.filepath.replace('{time}', `t${egressId}`) + '.ogg',
            startedAtMs: s.at,
          },
    );
  }
  async result(egressId: string): Promise<EgressResult> {
    return this.results.get(egressId) ?? { state: 'failed', error: 'unknown egress' };
  }
  /** What LiveKit still knows after a backend restart: every egress it was asked to start. */
  async orphans(): Promise<OrphanEgress[]> {
    if (this.failListing) throw new Error('livekit unreachable');
    return this.started.flatMap((s) => {
      const o = orphanOfPath(s.egressId, s.filepath);
      return o ? [o] : [];
    });
  }
}

let time: number;
let recorder: FakeRecorder;
let records: MemoryRecordsStore;
let jobs: MemoryJobQueue;
let acks: MemoryAckStore;
let capture: RecordingCapture;
let log: string[];

const change = (event: 'STARTED' | 'PAUSED' | 'RESUMED' | 'STOPPED') => ({
  campaignId: CAMPAIGN,
  recordingId: REC,
  event,
});
const publish = (identity: string) =>
  recorder.tracks.push({ identity, trackSid: `sid-${identity}-${recorder.tracks.length}` });

beforeEach(() => {
  time = 1_000_000;
  recorder = new FakeRecorder(() => time);
  records = new MemoryRecordsStore();
  jobs = new MemoryJobQueue();
  acks = new MemoryAckStore({ now: () => time });
  log = [];
  capture = makeCapture();
});

function makeCapture(extra: Partial<CaptureDeps> = {}): RecordingCapture {
  return new RecordingCapture({
    recorder,
    records,
    jobs,
    acks,
    dir: '/out/',
    speakerName: async (_c, id) => `name-of-${id}`,
    describeSound: async (id) =>
      ({
        door: { name: 'Door creak', category: 'effect' },
        wind: { name: 'Wind', category: 'ambience' },
      })[id],
    describeScene: async () => ['Dripping', 'Hum', 'Dripping'],
    now: () => time,
    newId: (() => {
      let i = 0;
      return () => `track-${++i}`;
    })(),
    log: (l) => log.push(l),
    sleep: async () => {
      time += 100;
    },
    pollMs: 100,
    ...extra,
  });
}

async function ack(user: string): Promise<void> {
  await acks.ack(CAMPAIGN, REC, user);
  capture.onAck(CAMPAIGN);
  await capture.idle();
}

describe('RecordingCapture', () => {
  it('writes a durable recording row and a "started" bookmark', async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(await records.getRecording(REC)).toMatchObject({
      campaignId: CAMPAIGN,
      status: 'recording',
      startedAt: 1_000_000,
    });
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual(['started']);
  });

  it("notes scene changes with their name and ambience in the recording's timeline, with the offset of when they happened", async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    time += 2_000;
    capture.onTableEvent(CAMPAIGN, 'scene.started', {
      sceneId: 'sc1',
      name: 'Crypt\u0007 \n of Bones',
    });
    time += 1_000;
    capture.onTableEvent(CAMPAIGN, 'scene.stopped', { sceneId: 'sc1' });
    capture.onTableEvent(CAMPAIGN, 'chat.message', { text: 'not a sound' });
    await capture.idle();
    const events = await records.listRecordingEvents(REC);
    expect(events.map((e) => e.event)).toEqual(['started', 'scene', 'scene']);
    expect(events[1]).toMatchObject({
      at: 1_002_000,
      detail: {
        action: 'start',
        sceneId: 'sc1',
        name: 'Crypt of Bones',
        ambience: ['Dripping', 'Hum'],
      },
    });
    expect(events[2]).toMatchObject({ at: 1_003_000, detail: { action: 'stop' } });
  });

  it('notes individual effects and loops only when RECORD_SOUNDBOARD is on, by name and category', async () => {
    const play = (id: string, mode: string, extra = {}) =>
      capture.onTableEvent(CAMPAIGN, 'sound.play', {
        playId: `p-${id}`,
        soundId: id,
        mode,
        ...extra,
      });
    // Off (the default): nothing about individual sounds, scenes still noted.
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    play('door', 'oneshot');
    capture.onTableEvent(CAMPAIGN, 'sound.stop', { playId: null });
    capture.onTableEvent(CAMPAIGN, 'scene.started', { sceneId: 'sc1', name: 'Crypt' });
    await capture.idle();
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual([
      'started',
      'scene',
    ]);

    // On: effects and loops are named, a loop's stop carries the loop's name.
    capture = makeCapture({ recordSounds: true });
    capture.onRecordingChange({ ...change('STARTED'), recordingId: 'rec-2' });
    await capture.idle();
    play('door', 'oneshot');
    play('wind', 'loop');
    capture.onTableEvent(CAMPAIGN, 'sound.stop', { playId: 'p-wind' });
    await capture.idle();
    const events = (await records.listRecordingEvents('rec-2')).filter((e) => e.event === 'sound');
    expect(events.map((e) => e.detail)).toEqual([
      { action: 'play', name: 'Door creak', category: 'effect', mode: 'oneshot' },
      { action: 'play', name: 'Wind', category: 'ambience', mode: 'loop' },
      { action: 'stop', name: 'Wind' },
    ]);
  });

  it('never notes a sound played to chosen people only', async () => {
    capture = makeCapture({ recordSounds: true });
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    capture.onTableEvent(
      CAMPAIGN,
      'sound.play',
      { playId: 'p', soundId: 'door', mode: 'oneshot' },
      new Set(['alice']),
    );
    await capture.idle();
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual(['started']);
  });

  it("notes the DM's character voice once per change, by name, and party splits and merges by member names", async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    time += 5_000;
    capture.onVoiceEffect(CAMPAIGN, 'dm', 'Dragon');
    capture.onVoiceEffect(CAMPAIGN, 'dm', 'dragon'); // same voice again: not noted twice
    const split = {
      parties: [
        { id: 'g1', name: 'Cave' },
        { id: 'g2', name: 'Tower\u0000' },
        { id: 'g3', name: 'Empty' },
      ],
      assignments: { bob: 'g1', alice: 'g1', carol: 'g2' },
    };
    capture.onPartyState(CAMPAIGN, { parties: [], assignments: {} }); // nothing yet: not a merge
    capture.onPartyState(CAMPAIGN, split);
    capture.onPartyState(CAMPAIGN, split); // unchanged
    capture.onPartyState(CAMPAIGN, { parties: split.parties, assignments: {} }); // everyone back
    await capture.idle();
    const events = (await records.listRecordingEvents(REC)).filter((e) =>
      ['voice', 'group'].includes(e.event),
    );
    expect(events.map((e) => [e.event, e.at, e.detail])).toEqual([
      ['voice', 1_005_000, { voice: 'dragon', by: 'name-of-dm' }],
      [
        'group',
        1_005_000,
        {
          groups: [
            { name: 'Cave', members: ['name-of-alice', 'name-of-bob'] },
            { name: 'Tower', members: ['name-of-carol'] },
          ],
        },
      ],
      ['group', 1_005_000, { groups: [] }],
    ]);
  });

  it('does not log scenes, voices or groups while nothing is recording or while the recording is paused', async () => {
    capture.onTableEvent(CAMPAIGN, 'scene.started', { sceneId: 's0', name: 'Before' });
    capture.onRecordingChange(change('STARTED'));
    capture.onRecordingChange(change('PAUSED'));
    await capture.idle();
    capture.onTableEvent(CAMPAIGN, 'scene.started', { sceneId: 's1', name: 'Paused' });
    capture.onVoiceEffect(CAMPAIGN, 'dm', 'giant');
    capture.onPartyState(CAMPAIGN, { parties: [{ id: 'g', name: 'G' }], assignments: { a: 'g' } });
    await capture.idle();
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual([
      'started',
      'paused',
    ]);
  });

  it('does not record a player until they have acknowledged the start cue', async () => {
    publish('alice');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(recorder.started).toHaveLength(0);
    await ack('alice');
    expect(recorder.started).toHaveLength(1);
    expect(recorder.started[0]?.filepath).toBe(`/out/${REC}/alice@{time}`);
  });

  it('records only the acknowledged speakers when several are publishing', async () => {
    publish('alice');
    publish('bob');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('alice');
    expect(recorder.started).toHaveLength(1);
    await ack('bob');
    expect(recorder.started).toHaveLength(2);
  });

  it('captures a late joiner only after they ack, and never twice', async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    publish('late');
    capture.onAck(CAMPAIGN); // a timer tick: published but not acknowledged
    await capture.idle();
    expect(recorder.started).toHaveLength(0);
    await ack('late');
    capture.onAck(CAMPAIGN);
    await capture.idle();
    expect(recorder.started).toHaveLength(1);
  });

  it('turns every file into a track on stop, with names and offsets, and queues one job', async () => {
    publish('alice');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('alice'); // egress starts at t=1_000_000
    time += 5_000;
    publish('bob');
    await ack('bob'); // egress starts at t=1_005_000
    time += 60_000;
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();

    const tracks = await records.listTracks(REC);
    expect(tracks.map((t) => [t.speakerId, t.speakerName, t.startOffsetMs, t.private])).toEqual([
      ['alice', 'name-of-alice', 0, false],
      ['bob', 'name-of-bob', 5_000, false],
    ]);
    expect(tracks[0]?.filePath).toMatch(new RegExp(`^/out/${REC}/alice@t`));
    expect(await records.getRecording(REC)).toMatchObject({ status: 'stopped', stoppedAt: time });
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual([
      'started',
      'stopped',
    ]);
    const queued = await jobs.list(['queued']);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: PROCESS_RECORDING_JOB, recordingId: REC });
  });

  it('keeps a sound-effects track as a private file that is never transcribed', async () => {
    publish('dm');
    recorder.tracks.push({ identity: 'dm', trackSid: 'sid-effects', effects: true });
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('dm');
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();
    const tracks = await records.listTracks(REC);
    const effects = tracks.find((t) => t.speakerName === 'Sound effects');
    expect(effects).toMatchObject({ speakerId: 'dm', private: true });
    expect(effects?.filePath).toMatch(new RegExp(`^/out/${REC}/dm-effects@t`));
    expect(tracks.find((t) => t.speakerName === 'name-of-dm')?.private).toBe(false);
  });

  it('keeps public chat typed from start to stop, pauses included, and nothing outside it', async () => {
    const line = (text: string) => ({
      senderId: 'alice',
      senderName: 'Aria',
      text,
      at: time,
    });
    capture.onChat(CAMPAIGN, line('before')); // nothing is recording yet
    await capture.idle();
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    time += 1000;
    capture.onChat(CAMPAIGN, line('during'));
    capture.onRecordingChange(change('PAUSED'));
    await capture.idle();
    time += 1000;
    capture.onChat(CAMPAIGN, line('while paused'));
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();
    capture.onChat(CAMPAIGN, line('after'));
    await capture.idle();
    const typed = (await records.listRecordingEvents(REC)).filter((e) => e.event === 'chat');
    expect(typed.map((e) => e.detail?.text)).toEqual(['during', 'while paused']);
    expect(typed[0]?.detail).toEqual({ senderId: 'alice', senderName: 'Aria', text: 'during' });
  });

  it('never puts an out-of-character line in the timeline, the transcript or search', async () => {
    const line = (text: string, kind?: 'chat' | 'say' | 'do' | 'ooc') => ({
      senderId: 'alice',
      senderName: 'Aria',
      text,
      at: time,
      ...(kind ? { kind } : {}),
    });
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    capture.onChat(CAMPAIGN, line('Aria is running late zebra', 'ooc'));
    capture.onChat(CAMPAIGN, line('plain zebra'));
    capture.onChat(CAMPAIGN, line('spoken zebra', 'say'));
    capture.onChat(CAMPAIGN, line('acts zebra', 'do'));
    await capture.idle();
    const typed = (await records.listRecordingEvents(REC)).filter((e) => e.event === 'chat');
    expect(typed.map((e) => e.detail?.text)).toEqual(['plain zebra', 'spoken zebra', 'acts zebra']);
    // The kind is kept on the line, so the worker can check it again.
    expect(typed.map((e) => e.detail?.kind)).toEqual([undefined, 'say', 'do']);
    const hits = await records.search(CAMPAIGN, 'zebra', { includeDmOnly: true, limit: 20 });
    expect(hits.map((h) => h.snippet).join(' ')).not.toContain('late');
    expect(hits).toHaveLength(3);
  });

  it('pause ends the files and resume starts new ones: a speaker gets one track per stretch', async () => {
    publish('alice');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('alice');
    time += 10_000;
    capture.onRecordingChange(change('PAUSED'));
    await capture.idle();
    expect(await records.listTracks(REC)).toHaveLength(1);

    time += 30_000; // paused: nothing is captured
    capture.onAck(CAMPAIGN);
    await capture.idle();
    expect(recorder.started).toHaveLength(1);

    capture.onRecordingChange(change('RESUMED'));
    await capture.idle();
    expect(recorder.started).toHaveLength(2);
    time += 10_000;
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();

    const tracks = await records.listTracks(REC);
    expect(tracks.map((t) => t.startOffsetMs)).toEqual([0, 40_000]);
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual([
      'started',
      'paused',
      'resumed',
      'stopped',
    ]);
  });

  it('registers a file that ended by itself when the speaker left', async () => {
    publish('alice');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('alice');
    recorder.tracks = []; // alice leaves; Egress finishes the file on its own
    recorder.finish('eg-1');
    capture.onAck(CAMPAIGN);
    await capture.idle();
    expect(await records.listTracks(REC)).toHaveLength(1);
  });

  it('survives a failed egress: no track for it, the recording still stops and is processed', async () => {
    publish('alice');
    recorder.failEgress.add('sid-alice-0');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    await ack('alice');
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();
    expect(await records.listTracks(REC)).toHaveLength(0);
    expect(log.join('\n')).toContain('failed: disk full');
    expect((await records.getRecording(REC))?.status).toBe('stopped');
    expect(await jobs.list(['queued'])).toHaveLength(1);
  });

  it('survives LiveKit being unreachable, and recovers on the next check', async () => {
    publish('alice');
    recorder.failListing = true;
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(log.join('\n')).toContain('livekit unreachable');
    expect(await records.getRecording(REC)).toBeDefined(); // the recording itself is intact
    recorder.failListing = false;
    await ack('alice');
    expect(recorder.started).toHaveLength(1);
  });

  it('queues the job even when nothing was captured', async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    capture.onRecordingChange(change('STOPPED'));
    await capture.idle();
    expect(await jobs.list(['queued'])).toHaveLength(1);
  });

  it('ignores events for a campaign it is not recording', async () => {
    capture.onRecordingChange(change('PAUSED'));
    capture.onRecordingChange(change('STOPPED'));
    capture.onAck('other');
    await capture.idle();
    expect(await jobs.list()).toHaveLength(0);
  });

  it('marks a recording that a restart cut off, instead of leaving it "recording" forever', async () => {
    await records.putRecording({
      id: 'orphan',
      campaignId: 'camp-x',
      startedAt: 1,
      stoppedAt: null,
      status: 'recording',
    });
    expect(await capture.recoverInterrupted()).toBe(1);
    expect((await records.getRecording('orphan'))?.status).toBe('failed');
    expect((await records.listRecordingEvents('orphan')).map((e) => e.event)).toEqual([
      'interrupted',
    ]);
  });

  describe('after a restart', () => {
    /** A new process: same database and same LiveKit, but no memory of the recording. */
    const restarted = () =>
      new RecordingCapture({
        recorder,
        records,
        jobs,
        acks,
        dir: '/out/',
        speakerName: async (_c, id) => `name-of-${id}`,
        now: () => time,
        newId: (() => {
          let i = 100;
          return () => `track-${++i}`;
        })(),
        log: (l) => log.push(l),
        sleep: async () => {
          time += 100;
        },
        pollMs: 100,
      });

    async function recordingWithTwoSpeakers() {
      capture.onRecordingChange(change('STARTED'));
      await capture.idle();
      publish('ann');
      publish('bo');
      await ack('ann');
      await ack('bo');
      expect(recorder.started).toHaveLength(2);
    }

    it('stops the egresses that kept running, keeps their audio as tracks and queues processing', async () => {
      await recordingWithTwoSpeakers();
      time += 60_000;

      const fresh = restarted();
      expect(await fresh.recoverInterrupted()).toBe(1);

      // Nothing is left recording invisibly: every egress was stopped.
      expect([...recorder.results.values()].map((r) => r.state)).toEqual(['complete', 'complete']);
      const tracks = await records.listTracks(REC);
      expect(tracks.map((t) => t.speakerId).sort()).toEqual(['ann', 'bo']);
      expect(tracks.every((t) => t.filePath.endsWith('.ogg'))).toBe(true);

      const recording = await records.getRecording(REC);
      expect(recording?.status).toBe('stopped');
      expect(recording?.stoppedAt).toBe(time);
      expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual([
        'started',
        'interrupted',
        'stopped',
      ]);
      expect(await jobs.list()).toHaveLength(1);
      expect(log.some((l) => l.includes('interrupted by a restart'))).toBe(true);
    });

    it('does not touch another recording’s egresses', async () => {
      await recordingWithTwoSpeakers();
      recorder.started.push({
        egressId: 'eg-other',
        trackSid: 'sid-x',
        filepath: '/out/someone-elses/zed@{time}',
        at: time,
      });
      recorder.results.set('eg-other', { state: 'active' });
      await restarted().recoverInterrupted();
      expect(recorder.results.get('eg-other')).toEqual({ state: 'active' });
    });

    it('marks the recording failed, loudly, when LiveKit cannot be asked', async () => {
      await recordingWithTwoSpeakers();
      recorder.failListing = true;
      expect(await restarted().recoverInterrupted()).toBe(1);
      expect((await records.getRecording(REC))?.status).toBe('failed');
      expect(await jobs.list()).toHaveLength(0);
      expect(log.some((l) => l.includes('could not recover'))).toBe(true);
    });
  });
});

describe('purging earlier audio when a session starts', () => {
  const OLD = 'rec-old';
  const seed = async (
    id: string,
    campaignId: string,
    status: 'processed' | 'processing' | 'stopped' | 'failed',
    purgedAt: number | null = null,
  ) => {
    await records.putRecording({ id, campaignId, startedAt: 1, stoppedAt: 2, status });
    await records.putTrack({
      id: `${id}-t`,
      recordingId: id,
      speakerId: 'u1',
      speakerName: 'U1',
      filePath: `/out/${id}.ogg`,
      startOffsetMs: 0,
      private: false,
      transcribedAt: null,
      purgedAt,
    });
  };
  const withRule = (on: boolean) => {
    capture = new RecordingCapture({
      recorder,
      records,
      jobs,
      acks,
      dir: '/out/',
      speakerName: async () => 'n',
      purgeOnNextSession: async () => on,
      now: () => time,
      log: (l) => log.push(l),
      sleep: async () => {
        time += 100;
      },
      pollMs: 100,
    });
  };
  const purgeJobs = async () =>
    (await jobs.list()).filter((j) => j.kind === 'purge-recording').map((j) => j.recordingId);

  it('queues a purge for this campaign’s earlier processed recordings, and logs it', async () => {
    withRule(true);
    await seed(OLD, CAMPAIGN, 'processed');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(await purgeJobs()).toEqual([OLD]);
    expect(log.some((l) => l.includes(OLD))).toBe(true);
  });

  it('does nothing when the setting is off (the default) or absent', async () => {
    withRule(false);
    await seed(OLD, CAMPAIGN, 'processed');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(await purgeJobs()).toEqual([]);
  });

  it('never touches a recording that is not fully processed, already purged, or another campaign’s', async () => {
    withRule(true);
    await seed('r-proc', CAMPAIGN, 'processing');
    await seed('r-stop', CAMPAIGN, 'stopped');
    await seed('r-fail', CAMPAIGN, 'failed');
    await seed('r-gone', CAMPAIGN, 'processed', 5);
    await seed('r-other', 'camp-2', 'processed');
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect(await purgeJobs()).toEqual([]);
  });

  it('still starts the recording if the rule cannot be read', async () => {
    capture = new RecordingCapture({
      recorder,
      records,
      jobs,
      acks,
      dir: '/out/',
      speakerName: async () => 'n',
      purgeOnNextSession: async () => {
        throw new Error('db down');
      },
      now: () => time,
      log: (l) => log.push(l),
    });
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    expect((await records.getRecording(REC))?.status).toBe('recording');
    expect(log.some((l) => l.includes('failed'))).toBe(true);
  });
});
