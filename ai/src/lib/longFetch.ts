import { Agent, fetch as undiciFetch } from 'undici';

/**
 * How long one request to Whisper or the LLM may take before it is given up. Node's own fetch gives up after 5 minutes without
 * a response, which a slow server (a CPU, a model that is still loading, a long transcript window) easily exceeds: the job then
 * failed with "fetch failed" and was retried. A transcription or summary has no useful time limit except "an hour is too long".
 */
export const AI_REQUEST_TIMEOUT_MS = 60 * 60_000;

const agent = new Agent({
  headersTimeout: AI_REQUEST_TIMEOUT_MS,
  bodyTimeout: AI_REQUEST_TIMEOUT_MS,
});

/** `fetch` for the AI backends: the same, with a long timeout. */
export const longFetch = ((
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) =>
  undiciFetch(
    input as never,
    { ...(init as object), dispatcher: agent } as never,
  )) as unknown as typeof fetch;
