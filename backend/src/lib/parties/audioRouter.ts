import { RoomServiceClient, TrackType } from 'livekit-server-sdk';

export interface RoomParticipant {
  identity: string;
  /** The audio tracks this person is publishing. */
  audioTrackSids: string[];
}

/** What party enforcement needs from LiveKit. The real one is {@link createLiveKitAudioRouter}. */
export interface AudioRouter {
  participants(room: string): Promise<RoomParticipant[]>;
  /** Subscribes (or unsubscribes) `listener` to the given tracks. */
  setSubscription(
    room: string,
    listener: string,
    trackSids: string[],
    subscribe: boolean,
  ): Promise<void>;
  /** Disconnects someone from the room, e.g. when they have left the campaign. */
  remove?(room: string, identity: string): Promise<void>;
}

/** The LiveKit server API: who is in the room, and per-listener subscriptions. */
export function createLiveKitAudioRouter(options: {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}): AudioRouter {
  const rooms = new RoomServiceClient(options.apiUrl, options.apiKey, options.apiSecret);
  return {
    async participants(room) {
      let list;
      try {
        list = await rooms.listParticipants(room);
      } catch {
        return []; // no room until someone joins
      }
      return list.map((p) => ({
        identity: p.identity,
        audioTrackSids: p.tracks.filter((t) => t.type === TrackType.AUDIO).map((t) => t.sid),
      }));
    },
    async setSubscription(room, listener, trackSids, subscribe) {
      if (trackSids.length === 0) return;
      await rooms.updateSubscriptions(room, listener, trackSids, subscribe);
    },
    async remove(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch {
        // Not in the room (or no room yet): nothing to disconnect.
      }
    },
  };
}
