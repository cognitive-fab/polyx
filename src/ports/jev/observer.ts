// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cognitive Fab LLC. This directory is licensed under the MIT
// License (see ./LICENSE), separately from the rest of polyx. See LICENSING.md.
//
// The Jev observer: the second implementation of the observation port, and
// the reason the first one exists. One call per text, the whole predicate
// battery in it (JT5.1), and every answer mapped through `emit` — the one
// place a probability becomes a fact, or nothing.
//
// Nothing above this knows the vendor. A second System One implementation,
// or a local classifier, drops in behind the same interface, and the manifest
// records which one answered.
import { emit, nullObserver, type Observation, type Observer, type Predicate } from 'polyx-lens';
import { JevClient, type JevClientOptions, type NoulQuestion } from './client.ts';

export interface JevObserverOptions extends JevClientOptions {
  model: string;
  /** Predicate-set version, stamped on every observation the annotation pass records. */
  version: number;
}

export function jevObserver(opts: JevObserverOptions): Observer & { readonly client: JevClient } {
  const client = new JevClient(opts);
  return {
    name: `jev:${opts.model}`,
    version: opts.version,
    client,
    async observe(text: string, predicates: Predicate[]): Promise<Observation[]> {
      if (predicates.length === 0) return [];
      const questions: Record<string, NoulQuestion> = {};
      for (const p of predicates) {
        const q: NoulQuestion = { type: 'noul', instructions: p.question };
        if (p.criteria) q.criteria = p.criteria;
        questions[p.id] = q;
      }
      const res = await client.ask({ state: text, model: opts.model, questions });
      const out: Observation[] = [];
      for (const p of predicates) {
        const a = res.answers[p.id];
        // The vendor guarantees the shape, so a missing key is not a parse
        // failure to paper over; it is a contract violation worth a loud error.
        if (!a || typeof a.noul !== 'number') throw new Error(`jev returned no noul for '${p.id}'`);
        const { noul, type: _type, ...rest } = a; // `type` echoes the question; not worth a byte per line
        const o: Observation = { predicate: p.id, fact: p.fact, value: emit(noul, p.bands), p: noul };
        if (Object.keys(rest).length) o.raw = rest;
        if (typeof res.model === 'string') o.model = res.model;
        out.push(o);
      }
      return out;
    },
  };
}

/**
 * The observer polyx runs with: Jev when a key is configured, the null one
 * otherwise (JT8.4). The fallback is the correct failure direction — an
 * abstention where an answer might have been available — and it is logged by
 * name so a degraded period is visible rather than mistaken for corpus drift.
 */
export function observerFromEnv(model: string, version: number, env: NodeJS.ProcessEnv = process.env): Observer {
  const key = env.POLYX_JEV_KEY;
  if (!key) return { ...nullObserver, version };
  return jevObserver({ key, model, version });
}
