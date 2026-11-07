import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { Segment } from '../types/index.js';
import { parseWhisperJson } from './whisperJson.js';

const execFileAsync = promisify(execFile);

export interface WhisperCliOptions {
  /** The binary: `whisper-cli`, or a wrapper such as infra/records-smoke/whisper-docker.sh. */
  bin?: string;
  modelPath: string;
  threads?: number;
  /** Fixed language code (`en`), or `auto`. A wrong guess on a short window costs accuracy. */
  language?: string;
}

/**
 * Runs whisper.cpp on one short WAV and returns its segments (times relative to that WAV).
 * `workBase` is a path without extension; whisper writes `<workBase>.json` beside it.
 */
export async function transcribeWavWithWhisperCli(
  wavPath: string,
  workBase: string,
  options: WhisperCliOptions,
): Promise<Segment[]> {
  const args = [
    '-m',
    options.modelPath,
    '-f',
    wavPath,
    '-oj',
    '-of',
    workBase,
    '-l',
    options.language ?? 'en',
  ];
  if (options.threads !== undefined) args.push('-t', String(options.threads));
  await execFileAsync(options.bin ?? 'whisper-cli', args, { maxBuffer: 16 * 1024 * 1024 });
  return parseWhisperJson(JSON.parse(await readFile(`${workBase}.json`, 'utf8')));
}
