// Synthetic speech for compose-e2e.ts: piper (a small local TTS) renders each line, ffmpeg turns it
// into 48 kHz mono 16-bit PCM — what a LiveKit microphone track carries. Rendered lines are cached by
// voice and text, so a rerun costs nothing.
//
// Install (user-local, no apt): the piper release tarball into ~/.local/share/piper and voices
// (`<name>.onnx` + `<name>.onnx.json` from huggingface.co/rhasspy/piper-voices) into
// ~/.local/share/piper-voices. PIPER_BIN / PIPER_VOICES override both paths.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const SAMPLE_RATE = 48_000;

export interface Tts {
  /** 48 kHz mono samples of `text` spoken in `voice`, with a short silence either side. */
  render(voice: string, text: string): Promise<Int16Array>;
}

export function piperTts(cacheDir: string): Tts {
  const bin = process.env.PIPER_BIN ?? path.join(homedir(), '.local/share/piper/piper');
  const voices = process.env.PIPER_VOICES ?? path.join(homedir(), '.local/share/piper-voices');
  if (!existsSync(bin)) {
    throw new Error(`piper not found at ${bin} (set PIPER_BIN; see infra/records-smoke/README.md)`);
  }
  return {
    async render(voice, text) {
      const model = path.join(voices, `${voice}.onnx`);
      if (!existsSync(model)) throw new Error(`piper voice ${model} is missing (set PIPER_VOICES)`);
      const key = createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16);
      const pcm = path.join(cacheDir, `${key}.s16`);
      if (!existsSync(pcm)) {
        await mkdir(cacheDir, { recursive: true });
        const wav = path.join(cacheDir, `${key}.wav`);
        const piper = run(bin, ['-m', model, '-f', wav, '-q']);
        piper.child.stdin?.end(text);
        await piper;
        // 48 kHz mono s16le, with 300 ms of silence either side so no word is clipped by the codec start.
        await run('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          wav,
          '-af',
          'adelay=300:all=1,apad=pad_dur=0.3',
          '-ac',
          '1',
          '-ar',
          String(SAMPLE_RATE),
          '-f',
          's16le',
          pcm,
        ]);
        await rm(wav, { force: true });
      }
      const buf = await readFile(pcm);
      return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    },
  };
}
