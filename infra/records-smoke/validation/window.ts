/**
 * How full the summary model's window got, read from Ollama's own log. A model reads a fixed number of tokens at once;
 * a prompt that does not fit is silently cut (Ollama logs `truncated = 1`). The demo campaign's extended session exists to
 * push the notes and the tale past a small window, so a run reports the fill and every cut, not just "it worked".
 *
 * Ollama (llama.cpp) logs, per request:
 *   slot update_slots: id  0 | task 12 | new prompt, n_ctx_slot = 8192, n_keep = 4, task.n_tokens = 7372
 *   slot      release: id  0 | task 12 | stop processing: n_tokens = 8078, truncated = 0
 */
export interface ModelWindow {
  /** Requests seen. */
  calls: number;
  /** The window the model ran with (tokens), when the log says. */
  window: number | undefined;
  /** The most tokens any one request held, prompt and answer. */
  maxTokens: number;
  /** maxTokens as a share of the window, 0 to 1 (more than 1 means the log shows a window smaller than the use). */
  maxFill: number | undefined;
  /** Requests whose prompt was cut to fit. */
  truncated: number;
  /** Requests over 90 % of the window: close enough that a longer session would be cut. */
  nearlyFull: number;
}

export function parseModelWindow(log: string): ModelWindow {
  let calls = 0;
  let maxTokens = 0;
  let truncated = 0;
  let window: number | undefined;
  const sizes: number[] = [];
  for (const line of log.split('\n')) {
    const w = /n_ctx_slot = (\d+)/.exec(line);
    if (w) window = Math.max(window ?? 0, Number(w[1]));
    const r = /stop processing: n_tokens = (\d+), truncated = (\d+)/.exec(line);
    if (r) {
      calls++;
      const n = Number(r[1]);
      sizes.push(n);
      maxTokens = Math.max(maxTokens, n);
      if (Number(r[2]) !== 0) truncated++;
    }
  }
  const maxFill = window ? maxTokens / window : undefined;
  const nearlyFull = window ? sizes.filter((n) => n > window! * 0.9).length : 0;
  return { calls, window, maxTokens, maxFill, truncated, nearlyFull };
}

/** One line for the report, and whether it is a finding worth a person's attention. */
export function describeModelWindow(m: ModelWindow): { text: string; notable: boolean } {
  if (m.calls === 0)
    return {
      text: 'no model requests in Ollama’s log (a remote model, or none ran)',
      notable: false,
    };
  const fill =
    m.maxFill === undefined
      ? ''
      : ` (${Math.round(m.maxFill * 100)} % of a ${m.window}-token window)`;
  const cut = m.truncated > 0 ? `; ${m.truncated} request(s) were CUT to fit` : '; none cut';
  const near = m.nearlyFull > 0 ? `; ${m.nearlyFull} over 90 % full` : '';
  return {
    text: `${m.calls} requests, the largest ${m.maxTokens} tokens${fill}${cut}${near}`,
    notable: m.truncated > 0 || m.nearlyFull > 0,
  };
}
