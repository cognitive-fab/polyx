// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cognitive Fab LLC. This directory is licensed under the MIT
// License (see ./LICENSE), separately from the rest of polyx. See LICENSING.md.
//
// `polyx annotate <corpus>` (JF6.1, JT5, JT7, JT8.5). The one command that
// makes a network call, and it is explicit and never implicit: `mine`,
// `audit`, `evaluate` and `diff` run offline against whatever this wrote.
//
// The shape of the pass follows from three measurements. A Jev call is not
// bit-stable, so the answers are recorded once and mining reads the
// recording. Latency is flat in the number of questions, so every predicate
// sharing a text rides one call. And templated messages repeat, so the pass
// groups by REDACTED TEXT across the whole corpus and calls once per
// distinct text, keyed by its hash (JT5.2) — which is also what lets a
// reader confirm two sites shared one call (JT3.1).
//
// Redaction happens before grouping, so the hash is of what was sent, and
// `--dry-run` writes exactly those payloads and sends nothing (JT7.3). That
// preview is the artefact a compliance reviewer reads before a key exists,
// and on any customer corpus it should exist before the first real run.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  activePredicates,
  isStale,
  joinEpisodeText,
  previewRedaction,
  profileId,
  redactText,
  textSourceFor,
  writeAnnotations,
  annotationPath,
  type AnnotationFile,
  type AnnotationLine,
  type LoadedCorpus,
  type Observer,
  type Predicate,
  type PredicateSet,
  type TextProfile,
} from 'polyx-lens';
import { resolveRaw } from '../../show.ts';

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** One place a predicate battery reads: a site, and the redacted text at it. */
export interface AnnotationSite {
  interactionId: string;
  episodeId: string;
  seq: number;
  /** Which predicates read this site — those whose source/window resolve to this text. */
  predicates: Predicate[];
  /** The REDACTED text. Nothing else is ever sent or written. */
  text: string;
  sha: string;
}

export interface AnnotateOptions {
  /** Calls the pass may make before stopping and writing a partial file (JT8.5). */
  budget?: number;
  /** Bounded concurrency (JT5.3). */
  concurrency?: number;
  now?: () => number;
}

export interface AnnotateReport {
  file: AnnotationFile | null;
  /** The model(s) that answered, as the responses named them. More than one means the vendor moved mid-pass. */
  models: string[];
  /** Sites with text a predicate could read. */
  sites: number;
  /** Distinct redacted texts — the number of calls a full pass makes. */
  distinct: number;
  callsMade: number;
  /** Sites answered from the text cache rather than a fresh call. */
  callsSaved: number;
  partial: boolean;
  /** Predicates declared but not run, and why — reported, never dropped (JF8.1). */
  skipped: Array<{ predicate: string; reason: string }>;
  /** Sites in the corpus with no text any predicate could read. */
  unobservable: number;
}

/**
 * Resolve every site a predicate could read, redact the text, and group the
 * predicates that share it. Pure apart from following RawRefs into source.
 */
export function resolveSites(corpus: LoadedCorpus, set: PredicateSet, profile: TextProfile, opts: { includeInert?: boolean } = {}): { sites: AnnotationSite[]; skipped: AnnotateReport['skipped']; unobservable: number } {
  const source = textSourceFor(corpus.config.adapter);
  // `skipped` always means "would not run in a real pass", whether or not the
  // caller asked to include inert predicates. The preview includes them —
  // the reviewer is looking at what could leave the machine — and still has
  // to say which ones would not actually be asked.
  const skipped: AnnotateReport['skipped'] = [];
  const active = new Set(activePredicates(set));
  const predicates: Predicate[] = [];
  for (const p of set.predicates) {
    let why: string | null = null;
    if (!active.has(p)) why = p.status !== 'real' ? `status ${p.status}` : 'uncalibrated';
    else if (isStale(p, corpus.revision, corpus.alphabet.version)) why = 'calibration stale (JF3.5)';
    if (why) skipped.push({ predicate: p.id, reason: why });
    if (!why || opts.includeInert) predicates.push(p);
  }

  const sites: AnnotationSite[] = [];
  let unobservable = 0;
  if (predicates.length === 0) return { sites, skipped, unobservable };

  for (const it of corpus.interactions) {
    // Event texts once per interaction; episode text composes from them.
    const eventText = new Map<number, string | null>();
    for (const e of it.events) {
      // No try/catch. A source file that cannot be read is a real failure of
      // the pass — the corpus has moved since ingestion — and swallowing it
      // would turn every site into "unobservable" and report a clean run over
      // nothing. That is the one thing this pass must never do.
      eventText.set(e.seq, source.text(resolveRaw(e.raw)));
    }
    const byEpisode = new Map<string, number[]>();
    for (const e of it.events) {
      let l = byEpisode.get(e.episode);
      if (!l) byEpisode.set(e.episode, (l = []));
      l.push(e.seq);
    }
    for (const e of it.events) {
      const groups = new Map<string, Predicate[]>();
      for (const p of predicates) {
        let raw: string | null = null;
        if (p.source === 'event.text') raw = eventText.get(e.seq) ?? null;
        else if (p.source === 'episode.text') {
          const seqs = (byEpisode.get(e.episode) ?? []).filter((s) => s <= e.seq);
          raw = joinEpisodeText(seqs.map((s) => eventText.get(s) ?? null));
        } else if (p.source.startsWith('slot.')) {
          const v = e.slots[p.source.slice(5)];
          raw = v === undefined || v === null ? null : String(v);
        }
        if (raw === null || !raw.trim()) continue;
        const text = redactText(raw, profile);
        let g = groups.get(text);
        if (!g) groups.set(text, (g = []));
        g.push(p);
      }
      if (groups.size === 0) {
        unobservable++;
        continue;
      }
      for (const [text, ps] of groups) sites.push({ interactionId: it.id, episodeId: e.episode, seq: e.seq, predicates: ps, text, sha: sha16(text) });
    }
  }
  return { sites, skipped, unobservable };
}

/**
 * JT7.3 — the exact payloads, and what they were before redaction, so a
 * reviewer can see what each rule caught. Sends nothing. The `before` field
 * exists ONLY here; the annotation store never carries text at all.
 */
export function writePreview(path: string, corpus: LoadedCorpus, set: PredicateSet, profile: TextProfile): { path: string; sites: number; distinct: number; skipped: AnnotateReport['skipped'] } {
  const source = textSourceFor(corpus.config.adapter);
  // The preview runs over EVERY declared predicate, calibrated or not: the
  // reviewer is looking at what would leave the machine, and a predicate
  // calibrated next week reads the same text.
  const { sites, skipped } = resolveSites(corpus, set, profile, { includeInert: true });
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const s of sites) {
    if (seen.has(s.sha)) continue;
    seen.add(s.sha);
    // Recover the original for the side-by-side. Only `event.text` and slot
    // sources are recoverable from one event; an episode text is shown as
    // its redacted form with the rule counts.
    let before: string | null = null;
    const ev = corpus.interactions.find((i) => i.id === s.interactionId)?.events.find((e) => e.seq === s.seq);
    if (ev) {
      const p0 = s.predicates[0]!;
      if (p0.source === 'event.text') {
        try {
          before = source.text(resolveRaw(ev.raw));
        } catch {
          before = null;
        }
      } else if (p0.source.startsWith('slot.')) {
        const v = ev.slots[p0.source.slice(5)];
        before = v === undefined || v === null ? null : String(v);
      }
    }
    const pv = before !== null ? previewRedaction(before, profile) : { before: null, after: s.text, fired: {} };
    lines.push(JSON.stringify({ sha: s.sha, predicates: s.predicates.map((p) => p.id), redaction: profileId(profile), fired: pv.fired, before: pv.before, after: pv.after }));
  }
  writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return { path, sites: sites.length, distinct: seen.size, skipped };
}

/**
 * The frozen pass (JF6.1). Calls once per distinct redacted text, bounded
 * concurrency, stops on budget and marks the file partial.
 */
export async function annotate(corpus: LoadedCorpus, set: PredicateSet, profile: TextProfile, observer: Observer, workspace: string, opts: AnnotateOptions = {}): Promise<AnnotateReport> {
  const { sites, skipped, unobservable } = resolveSites(corpus, set, profile);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const redaction = profileId(profile);

  // Group by text across the corpus. Every predicate that reads a given text
  // anywhere is asked in the one call for it, so the cache is complete.
  const byText = new Map<string, { text: string; predicates: Map<string, Predicate>; sites: AnnotationSite[] }>();
  for (const s of sites) {
    let g = byText.get(s.sha);
    if (!g) byText.set(s.sha, (g = { text: s.text, predicates: new Map(), sites: [] }));
    for (const p of s.predicates) g.predicates.set(p.id, p);
    g.sites.push(s);
  }
  const groups = [...byText.values()];
  const budget = opts.budget ?? Infinity;
  const concurrency = Math.max(1, opts.concurrency ?? 4);

  const lines: AnnotationLine[] = [];
  let callsMade = 0;
  let callsSaved = 0;
  let partial = false;
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= groups.length) return;
      if (callsMade >= budget) {
        partial = true;
        return;
      }
      const g = groups[i]!;
      callsMade++;
      const preds = [...g.predicates.values()];
      const obs = await observer.observe(g.text, preds);
      const at = now();
      for (const s of g.sites) {
        // Every predicate that reads this site gets its line, including a
        // withheld one: a missing line and a withheld line mean different
        // things, and only the second says the predicate was asked.
        for (const p of s.predicates) {
          const o = obs.find((x) => x.predicate === p.id);
          if (!o) continue; // the null observer: nothing was asked, so nothing is recorded
          const line: AnnotationLine = { i: s.interactionId, e: s.episodeId, seq: s.seq, pred: p.id, p: o.p, fact: p.fact, value: o.value, pv: set.version, redaction, sha: s.sha, at };
          if (o.raw) line.raw = o.raw;
          if (o.model) line.model = o.model;
          lines.push(line);
        }
      }
      callsSaved += g.sites.length - 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));

  const file = lines.length ? writeAnnotations(annotationPath(workspace, corpus.name, set.version), lines, { partial }) : null;
  const models = [...new Set(lines.map((l) => l.model).filter((m): m is string => Boolean(m)))].sort();
  return { file, models, sites: sites.length, distinct: groups.length, callsMade, callsSaved, partial, skipped, unobservable };
}
