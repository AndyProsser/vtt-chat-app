import {
  DirectFileOutput,
  EgressClient,
  EgressStatus,
  RoomServiceClient,
  TrackType,
} from 'livekit-server-sdk';

import type { EgressResult, RecorderTrack, TrackRecorder } from './capture.js';

/** The DM's sound-effects track (the tray app publishes it under this name); never recorded. */
export const SOUNDBOARD_TRACK = 'soundboard';

interface ParticipantLike {
  identity: string;
  tracks: { sid: string; name: string; type: TrackType; muted: boolean }[];
}

/**
 * The audio tracks worth recording: voices, not muted, and never the soundboard, unless the operator
 * switched `includeEffects` on (RECORD_SOUNDBOARD, for testing). Then the soundboard comes back flagged
 * `effects`, to be kept as a private file that is never transcribed.
 */
export function recordableTracks(
  participants: ParticipantLike[],
  options: { includeEffects?: boolean } = {},
): RecorderTrack[] {
  return participants.flatMap((p) =>
    p.tracks
      .filter(
        (t) =>
          t.type === TrackType.AUDIO &&
          !t.muted &&
          (t.name !== SOUNDBOARD_TRACK || options.includeEffects === true),
      )
      .map((t) =>
        t.name === SOUNDBOARD_TRACK
          ? { identity: p.identity, trackSid: t.sid, effects: true }
          : { identity: p.identity, trackSid: t.sid },
      ),
  );
}

/**
 * The real {@link TrackRecorder}: LiveKit's room API to find who is publishing audio, and Egress's
 * **track egress** to write one file per speaker (never a mixed file). `apiUrl` is the LiveKit
 * server's HTTP address as seen from the backend.
 */
export function createLiveKitRecorder(options: {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Also keep the soundboard track, as a private effects file (testing). */
  includeEffects?: boolean;
}): TrackRecorder {
  const rooms = new RoomServiceClient(options.apiUrl, options.apiKey, options.apiSecret);
  const egress = new EgressClient(options.apiUrl, options.apiKey, options.apiSecret);

  return {
    async listAudioTracks(room): Promise<RecorderTrack[]> {
      let participants;
      try {
        participants = await rooms.listParticipants(room);
      } catch {
        return []; // the room does not exist until someone joins it
      }
      return recordableTracks(participants, { includeEffects: options.includeEffects });
    },

    async start(room, trackSid, filepath) {
      const info = await egress.startTrackEgress(
        room,
        new DirectFileOutput({ filepath }),
        trackSid,
      );
      return info.egressId;
    },

    async stop(egressId) {
      await egress.stopEgress(egressId);
    },

    async result(egressId): Promise<EgressResult> {
      const [info] = await egress.listEgress({ egressId });
      if (!info) return { state: 'failed', error: 'egress not found' };
      if (
        info.status === EgressStatus.EGRESS_STARTING ||
        info.status === EgressStatus.EGRESS_ACTIVE ||
        info.status === EgressStatus.EGRESS_ENDING
      ) {
        return { state: 'active' };
      }
      if (info.status !== EgressStatus.EGRESS_COMPLETE) {
        return {
          state: 'failed',
          error: info.error || `egress ended as ${EgressStatus[info.status]}`,
        };
      }
      const file = info.fileResults[0];
      return {
        state: 'complete',
        ...(file?.filename ? { file: file.filename } : {}),
        // LiveKit reports nanoseconds since the epoch.
        ...(file?.startedAt ? { startedAtMs: Number(file.startedAt / 1_000_000n) } : {}),
      };
    },
  };
}
