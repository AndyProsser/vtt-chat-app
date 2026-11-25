const RATE = 16_000;

/**
 * A short 16 kHz mono 16-bit WAV of a steady tone, the format Whisper is fed. Not speech: it only proves the server
 * accepts audio and answers, which is what a connection test needs (and no recording of anyone's voice is ever kept in
 * the repository).
 */
export function toneWav(seconds = 1, hz = 440): Buffer {
  const samples = Math.round(RATE * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    data.writeInt16LE(Math.round(8_000 * Math.sin((2 * Math.PI * hz * i) / RATE)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
