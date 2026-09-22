// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cognitive Fab LLC. This directory is licensed under the MIT
// License (see ./LICENSE), separately from the rest of polyx. See LICENSING.md.
//
// The Jev HTTP client (JT5.3, W4.3). The only module in either package that
// makes a network call, and the boundary check keeps it that way.
//
// Thin, on purpose. The vendor guarantees the response shape — "the model
// never makes type errors… mathematically impossible" — so there is no
// parsing, no schema repair and no malformed-response fallback here. What
// there is: bearer auth, a timeout, and exponential backoff on 429 and 529,
// which are the two codes the harness measured. Everything else is an error
// with the status and the first few hundred bytes of the body.
//
// The wire format, from the harness that measured it (A2):
//
//   POST https://api.typesafe.ai/v1/systemone
//   { state, model, questions: { <name>: { type: 'noul', instructions, criteria? } } }
//   → { model: 'jev-1.13.0', answers: { <name>: { type: 'noul', noul: p } }, usage }
//
// `questions` is a map keyed by name and `answers` comes back under the same
// keys, so a predicate's id is the wire key and a whole battery is one call.
// W0.3, answered on 21 September 2026 by printing one whole response: an
// answer carries nothing beyond its probability (`type` is an echo), so what
// we had called confidence is `p`. The response does carry the MODEL that
// answered, versioned, which every earlier probe had discarded — that is the
// dated id the risk register said did not exist, and it is passed up.
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface JevRequest {
  state: string;
  model: string;
  questions: Record<string, NoulQuestion>;
}

export interface JevAnswer {
  noul: number;
  [k: string]: unknown;
}

export interface JevResponse {
  /** The model that answered — `jev-1.13.0` — whatever `model` the request named. */
  model?: string;
  answers: Record<string, JevAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface JevClientOptions {
  key: string;
  url?: string;
  timeoutMs?: number;
  retries?: number;
  /** First backoff on 429/529, doubled each retry. Default 500ms. */
  baseDelayMs?: number;
  /** Injected in tests; `fetch` otherwise. */
  fetch?: typeof fetch;
}

export interface JevCallStats {
  calls: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  wallMs: number;
}

export class JevError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`jev ${status}: ${body.slice(0, 400)}`);
    this.name = 'JevError';
    this.status = status;
  }
}

export class JevClient {
  readonly stats: JevCallStats = { calls: 0, retries: 0, inputTokens: 0, outputTokens: 0, wallMs: 0 };
  private readonly opts: Required<Omit<JevClientOptions, 'fetch'>> & { fetch: typeof fetch };

  constructor(opts: JevClientOptions) {
    if (!opts.key) throw new Error('a key is required — with none, use nullObserver');
    this.opts = { key: opts.key, url: opts.url ?? JEV_URL, timeoutMs: opts.timeoutMs ?? 60_000, retries: opts.retries ?? 4, baseDelayMs: opts.baseDelayMs ?? 500, fetch: opts.fetch ?? fetch };
  }

  async ask(req: JevRequest): Promise<JevResponse> {
    let delay = this.opts.baseDelayMs;
    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now();
      const res = await this.opts.fetch(this.opts.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      this.stats.wallMs += Date.now() - t0;
      if ((res.status === 429 || res.status === 529) && attempt < this.opts.retries) {
        this.stats.retries++;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      if (!res.ok) throw new JevError(res.status, await res.text());
      const out = (await res.json()) as JevResponse;
      this.stats.calls++;
      this.stats.inputTokens += out.usage?.input_tokens ?? 0;
      this.stats.outputTokens += out.usage?.output_tokens ?? 0;
      return out;
    }
  }
}
