// Starts one LiveKit *track egress* per published audio track in a room, so each speaker is
// written to its own file (never a single mixed recording) — the premise of the records design.
// Throwaway smoke-test script (ROADMAP Stage 2 Part B); see README.md in this folder.
//
//   node start-track-egress.ts <room> <output-dir>
//   node start-track-egress.ts --stop <egress-id> [<egress-id> ...]
//
// Needs LIVEKIT_URL (http://…), LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the environment.
// Run from the repo root so `livekit-server-sdk` resolves from the workspace's node_modules.

import { DirectFileOutput, EgressClient, RoomServiceClient, TrackType } from 'livekit-server-sdk';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const url = requireEnv('LIVEKIT_URL');
  const apiKey = requireEnv('LIVEKIT_API_KEY');
  const apiSecret = requireEnv('LIVEKIT_API_SECRET');
  const egress = new EgressClient(url, apiKey, apiSecret);
  const args = process.argv.slice(2);

  if (args[0] === '--stop') {
    for (const id of args.slice(1)) {
      await egress.stopEgress(id);
      console.log(`stopped ${id}`);
    }
    return;
  }

  const [room, outputDir] = args;
  if (!room || !outputDir) throw new Error('usage: start-track-egress.ts <room> <output-dir>');

  const rooms = new RoomServiceClient(url, apiKey, apiSecret);
  const participants = await rooms.listParticipants(room);

  let started = 0;
  for (const participant of participants) {
    for (const track of participant.tracks) {
      if (track.type !== TrackType.AUDIO) continue;
      // `{publisher_identity}` and `{time}` are Egress filename templates, so the file is named
      // for its speaker — the pipeline derives "who said it" from the filename, not from audio.
      const output = new DirectFileOutput({
        filepath: `${outputDir}/${participant.identity}@{time}`,
      });
      const info = await egress.startTrackEgress(room, output, track.sid);
      console.log(`${participant.identity}: track ${track.sid} → egress ${info.egressId}`);
      started += 1;
    }
  }
  if (started === 0) console.log(`no published audio tracks in room "${room}"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
