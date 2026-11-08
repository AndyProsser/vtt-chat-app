import { MemoryJobQueue, MemoryRecordsStore, PROCESS_RECORDING_JOB } from '@vtt-chat-app/ai';
import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryAckStore } from './ackStore.js';
import {
  RecordingCapture,
  type EgressResult,
  type RecorderTrack,
  type TrackRecorder,
} from './capture.js';

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
  capture = new RecordingCapture({
    recorder,
    records,
    jobs,
    acks,
    dir: '/out/',
    speakerName: async (_c, id) => `name-of-${id}`,
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
  });
});

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

  it('notes which effects and scenes were played in the recording\'s timeline, but not their audio', async () => {
    capture.onRecordingChange(change('STARTED'));
    await capture.idle();
    time += 2_000;
    capture.onTableEvent(CAMPAIGN, 'sound.play', {
      playId: 'p1',
      soundId: 's1',
      takeId: 't1',
      mode: 'oneshot',
      volume: 0.8,
      targets: undefined,
    });
    capture.onTableEvent(CAMPAIGN, 'scene.started', { sceneId: 'sc1', name: 'Crypt' });
    capture.onTableEvent(CAMPAIGN, 'scene.stopped', { sceneId: 'sc1' });
    capture.onTableEvent(CAMPAIGN, 'chat.message', { text: 'not a sound' });
    await capture.idle();
    const events = await records.listRecordingEvents(REC);
    expect(events.map((e) => e.event)).toEqual(['started', 'sound', 'scene', 'scene']);
    expect(events[1]).toMatchObject({
      at: 1_002_000,
      detail: { action: 'play', soundId: 's1', takeId: 't1', mode: 'oneshot', volume: 0.8 },
    });
    expect(events[2]?.detail).toEqual({ action: 'start', sceneId: 'sc1', name: 'Crypt' });
    expect(events[3]?.detail).toMatchObject({ action: 'stop' });
  });

  it('does not log effects while nothing is recording or while the recording is paused', async () => {
    capture.onTableEvent(CAMPAIGN, 'sound.play', { soundId: 's0' });
    capture.onRecordingChange(change('STARTED'));
    capture.onRecordingChange(change('PAUSED'));
    await capture.idle();
    capture.onTableEvent(CAMPAIGN, 'sound.play', { soundId: 's1' });
    await capture.idle();
    expect((await records.listRecordingEvents(REC)).map((e) => e.event)).toEqual(['started', 'paused']);
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
});
