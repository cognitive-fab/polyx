// Rule persistence and lifecycle (TS §7.6, F5.2, F5.3).
//
// Identity is the key. Re-mining an unchanged corpus produces the same ids,
// so an adjudication made last week still applies to the rule mined today.
// Support, evidence and counter-examples are overwritten every run; the
// human's verdict is not — unless the evidence moved enough to justify
// asking again, and then the reason is shown.
import { type Manifest, type Thresholds } from '@cognitive-fab/polyx-lens';
import { ratio, unproducedFacts, type Condition, type PredicateSet, type Rule, type RuleStatus, type Window } from '@cognitive-fab/polyx-lens';
import type { Contradiction } from '../mine/contradictions.ts';
import type { Store } from './db.ts';

const ADJUDICATED: RuleStatus[] = ['real', 'not_real', 'narrowed'];
const COMPUTED: RuleStatus[] = ['proposed', 'refused', 'suppressed', 'contradicted'];

interface Row {
  id: string;
  family: string;
  pattern: string;
  bindings_json: string;
  conditions_json: string;
  window: string;
  text: string;
  support_holds: number;
  support_of: number;
  corpus_support_holds: number;
  corpus_support_of: number;
  counterexamples_json: string;
  examples_json: string;
  provenance_json: string;
  status: string;
  predicate_js: string;
  alphabet_version: number;
  mined_at: number;
  suppressed_by: string | null;
  corpus: string;
  scope: string;
  run_id: string;
  retired_reason: string | null;
  evidence: string;
  parent_id: string | null;
  reproposed_reason: string | null;
  outcome_holds: number | null;
  outcome_of: number | null;
}

function fromRow(r: Row): Rule {
  const rule: Rule = {
    id: r.id,
    family: r.family as Rule['family'],
    pattern: r.pattern,
    bindings: JSON.parse(r.bindings_json),
    conditions: JSON.parse(r.conditions_json),
    window: r.window as Window,
    support: { holds: r.support_holds, of: r.support_of },
    corpusSupport: { holds: r.corpus_support_holds, of: r.corpus_support_of },
    counterexamples: JSON.parse(r.counterexamples_json),
    examples: JSON.parse(r.examples_json),
    provenance: JSON.parse(r.provenance_json),
    status: r.status as RuleStatus,
    predicates: { js: r.predicate_js },
    alphabetVersion: r.alphabet_version,
    minedAt: r.mined_at,
    text: r.text,
    evidence: r.evidence,
    corpus: r.corpus,
    scope: r.scope,
  };
  if (r.suppressed_by) rule.suppressedBy = r.suppressed_by;
  if (r.parent_id) rule.parentId = r.parent_id;
  if (r.reproposed_reason) rule.reproposedReason = r.reproposed_reason;
  if (r.retired_reason) rule.retiredReason = r.retired_reason;
  if (r.outcome_of !== null && r.outcome_of !== undefined) rule.outcomeSupport = { holds: r.outcome_holds ?? 0, of: r.outcome_of };
  return rule;
}

const UPSERT = `
INSERT INTO rules (id, family, pattern, bindings_json, conditions_json, window, text, support_holds, support_of,
  corpus_support_holds, corpus_support_of, counterexamples_json, examples_json, provenance_json, status, predicate_js,
  alphabet_version, mined_at, suppressed_by, corpus, scope, run_id, retired_reason, evidence, parent_id, reproposed_reason, outcome_holds, outcome_of)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id, corpus, scope) DO UPDATE SET
  text = excluded.text, support_holds = excluded.support_holds, support_of = excluded.support_of,
  corpus_support_holds = excluded.corpus_support_holds, corpus_support_of = excluded.corpus_support_of,
  counterexamples_json = excluded.counterexamples_json, examples_json = excluded.examples_json,
  provenance_json = excluded.provenance_json, status = excluded.status, predicate_js = excluded.predicate_js,
  alphabet_version = excluded.alphabet_version, mined_at = excluded.mined_at, suppressed_by = excluded.suppressed_by,
  run_id = excluded.run_id, retired_reason = excluded.retired_reason, evidence = excluded.evidence,
  parent_id = excluded.parent_id, reproposed_reason = excluded.reproposed_reason,
  outcome_holds = excluded.outcome_holds, outcome_of = excluded.outcome_of`;

function write(store: Store, r: Rule, runId: string): void {
  store
    .prepare(UPSERT)
    .run(
      r.id,
      r.family,
      r.pattern,
      JSON.stringify(r.bindings),
      JSON.stringify(r.conditions),
      r.window,
      r.text,
      r.support.holds,
      r.support.of,
      r.corpusSupport.holds,
      r.corpusSupport.of,
      JSON.stringify(r.counterexamples),
      JSON.stringify(r.examples),
      JSON.stringify(r.provenance),
      r.status,
      r.predicates.js,
      r.alphabetVersion,
      r.minedAt,
      r.suppressedBy ?? null,
      r.corpus,
      r.scope,
      runId,
      r.retiredReason ?? null,
      r.evidence,
      r.parentId ?? null,
      r.reproposedReason ?? null,
      r.outcomeSupport?.holds ?? null,
      r.outcomeSupport?.of ?? null,
    );
  store.prepare('DELETE FROM evidence WHERE rule_id = ? AND corpus = ? AND scope = ?').run(r.id, r.corpus, r.scope);
  const ins = store.prepare('INSERT OR IGNORE INTO evidence (rule_id, corpus, scope, interaction_id, episode_id, seq, holds) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const e of r.examples) ins.run(r.id, r.corpus, r.scope, e.interactionId, e.episodeId, e.seq, 1);
  for (const e of r.counterexamples) ins.run(r.id, r.corpus, r.scope, e.interactionId, e.episodeId, e.seq, 0);
}

export interface PersistStats {
  inserted: number;
  updated: number;
  kept: number;
  reproposed: number;
  retired: number;
  removed: number;
}

/**
 * Merge one mining run into the store. Every rule comes back with the status
 * it ended up with, so the caller can report what the human's earlier
 * verdicts did to this run's proposals.
 */
export function persistMined(store: Store, manifest: Manifest, rules: Rule[], contradictions: Contradiction[], t: Thresholds): PersistStats {
  const stats: PersistStats = { inserted: 0, updated: 0, kept: 0, reproposed: 0, retired: 0, removed: 0 };
  const key = (r: { id: string; scope: string }) => `${r.id}|${r.scope}`;
  const existing = new Map(
    (store.prepare('SELECT * FROM rules WHERE corpus = ?').all(manifest.corpus) as unknown as Row[]).map((r) => [key(r), fromRow(r)]),
  );
  const seen = new Set<string>();
  store.exec('BEGIN');
  try {
    for (const r of rules) {
      seen.add(key(r));
      const prev = existing.get(key(r));
      if (!prev) {
        write(store, r, manifest.runId);
        stats.inserted++;
        continue;
      }
      // Carry what the human decided; overwrite what the corpus says.
      if (prev.parentId) r.parentId = prev.parentId;
      if (ADJUDICATED.includes(prev.status)) {
        const moved = Math.abs(ratio(r.support) - ratio(prev.support));
        if (prev.status === 'not_real' && moved >= t.reproposalDelta) {
          r.status = 'proposed';
          r.reproposedReason = `marked not real at ${prev.support.holds}/${prev.support.of}; support moved to ${r.support.holds}/${r.support.of} (Δ ${moved.toFixed(2)} ≥ ${t.reproposalDelta})`;
          stats.reproposed++;
        } else if (prev.status === 'real' && (r.support.of < t.minInstances || r.status === 'refused')) {
          const gone = r.status === 'refused';
          r.status = 'retired';
          r.retiredReason = gone ? 'own evidence gone' : `support ${r.support.holds}/${r.support.of} fell below the floor of ${t.minInstances}`;
          stats.retired++;
        } else {
          r.status = prev.status;
          stats.kept++;
        }
      } else if (prev.status === 'retired') {
        // A retired rule that clears the floor again is re-proposed, with the reason shown.
        if (r.status === 'proposed') {
          r.reproposedReason = `retired (${prev.retiredReason ?? 'no reason recorded'}); support is now ${r.support.holds}/${r.support.of}`;
          stats.reproposed++;
        } else {
          r.status = 'retired';
          if (prev.retiredReason) r.retiredReason = prev.retiredReason;
        }
      } else {
        stats.updated++;
      }
      write(store, r, manifest.runId);
    }
    // What this run did not mine at all.
    for (const [k, prev] of existing) {
      if (seen.has(k)) continue;
      if (ADJUDICATED.includes(prev.status) || prev.status === 'proposed') {
        store
          .prepare("UPDATE rules SET status = 'retired', retired_reason = ?, run_id = ? WHERE id = ? AND corpus = ? AND scope = ?")
          .run(`not mined by run ${manifest.runId} (alphabet v${manifest.alphabetVersion})`, manifest.runId, prev.id, prev.corpus, prev.scope);
        stats.retired++;
      } else if (COMPUTED.includes(prev.status)) {
        store.prepare('DELETE FROM rules WHERE id = ? AND corpus = ? AND scope = ?').run(prev.id, prev.corpus, prev.scope);
        store.prepare('DELETE FROM evidence WHERE rule_id = ? AND corpus = ? AND scope = ?').run(prev.id, prev.corpus, prev.scope);
        stats.removed++;
      }
    }
    const ins = store.prepare('INSERT OR IGNORE INTO contradictions (run_id, scope, rule_a, rule_b, reason) VALUES (?, ?, ?, ?, ?)');
    for (const c of contradictions) ins.run(manifest.runId, c.scope, c.a, c.b, c.reason);
    store.exec('COMMIT');
  } catch (e) {
    store.exec('ROLLBACK');
    throw e;
  }
  return stats;
}

export interface RuleFilter {
  corpus?: string;
  scope?: string;
  status?: RuleStatus[];
  ownOnly?: boolean;
}

export function loadRules(store: Store, f: RuleFilter = {}): Rule[] {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (f.corpus) {
    where.push('corpus = ?');
    args.push(f.corpus);
  }
  if (f.scope) {
    where.push('scope = ?');
    args.push(f.scope);
  }
  if (f.status?.length) {
    where.push(`status IN (${f.status.map(() => '?').join(',')})`);
    args.push(...f.status);
  }
  const rows = store
    .prepare(`SELECT * FROM rules ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY scope, status, CAST(support_holds AS REAL) / MAX(support_of, 1) DESC, support_of DESC, id`)
    .all(...args) as unknown as Row[];
  const rules = rows.map(fromRow);
  return f.ownOnly ? rules.filter((r) => r.provenance.kind === 'own') : rules;
}

/** One rule row. Without a scope and corpus, the id must be unambiguous — the same rule mined for two operators or two corpora is two rows. */
export function loadRule(store: Store, id: string, scope?: string, corpus?: string): Rule | undefined {
  const where = ['id = ?'];
  const args: string[] = [id];
  if (scope !== undefined) {
    where.push('scope = ?');
    args.push(scope);
  }
  if (corpus !== undefined) {
    where.push('corpus = ?');
    args.push(corpus);
  }
  const rows = store.prepare(`SELECT * FROM rules WHERE ${where.join(' AND ')}`).all(...args) as unknown as Row[];
  if (rows.length > 1) throw new Error(`rule ${id} exists for ${rows.length} rows (${rows.map((r) => `${r.corpus}/${r.scope}`).join(', ')}); say which with --scope`);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export type ReviewVerdict = 'real' | 'not_real' | 'narrowed';

export interface Adjudication {
  ruleId: string;
  corpus: string;
  scope: string;
  at: number;
  verdict: ReviewVerdict;
  note?: string;
  reviewer?: string;
  support: { holds: number; of: number };
  condition?: Condition;
}

/** Record a verdict (F5.2). `narrowed` carries the condition the reviewer wants; the next mine emits the child. */
export function adjudicate(store: Store, ruleId: string, verdict: ReviewVerdict, opts: { note?: string; reviewer?: string; condition?: Condition; at?: number; scope?: string; corpus?: string; predicates?: PredicateSet | null } = {}): Rule {
  const rule = loadRule(store, ruleId, opts.scope, opts.corpus);
  if (!rule) throw new Error(`no rule ${ruleId}`);
  if (verdict === 'narrowed' && !opts.condition) throw new Error('narrowed needs a condition (--condition fact=value)');
  // JF4.3 — a rule cannot be real while a predicate it depends on is not.
  // Served, it would abstain at every request while looking like a rule in
  // service. The check is here, at the one place status becomes `real`, so
  // the CLI and the review page cannot disagree about it.
  if (verdict === 'real' || verdict === 'narrowed') {
    const conditions = [...rule.conditions, ...(opts.condition ? [opts.condition] : [])];
    const missing = unproducedFacts(conditions, opts.predicates ?? null);
    if (missing.length) {
      throw new Error(`rule ${ruleId} depends on ${missing.join(', ')}, which no real, calibrated predicate produces (JF4.3). Calibrate and adjudicate the predicate first: polyx predicates ${rule.corpus}`);
    }
  }
  const at = opts.at ?? Date.now();
  const note = opts.condition ? JSON.stringify({ note: opts.note ?? '', condition: opts.condition }) : (opts.note ?? null);
  store
    .prepare('INSERT INTO adjudications (rule_id, corpus, scope, at, verdict, note, support_holds, support_of, reviewer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ruleId, rule.corpus, rule.scope, at, verdict, note, rule.support.holds, rule.support.of, opts.reviewer ?? null);
  store.prepare('UPDATE rules SET status = ?, reproposed_reason = NULL WHERE id = ? AND corpus = ? AND scope = ?').run(verdict, ruleId, rule.corpus, rule.scope);
  return loadRule(store, ruleId, rule.scope, rule.corpus)!;
}

/**
 * One verdict for every project the rule was mined for — "real everywhere".
 *
 * The same rule mined for twenty-five operators is twenty-five rows, each with
 * its own support, and until now each wanted its own verdict: a reviewer who
 * meant "read the file before editing it" had to say so twenty-five times.
 * This records the verdict row by row, at each row's own support, so the
 * audit trail is exactly what twenty-five separate marks would have left.
 *
 * Only rows still `proposed` WITH OWN EVIDENCE are marked. A borrowed row
 * is proposed because other operators keep the rule, not this one: its own
 * support is below the floor, sometimes at zero. The first version marked
 * those too, and "read a file before editing it, in the same prompt" went
 * real at 15/94, 12/347 and 0/21 — a rule served at a project that breaks it
 * five times in six warns on almost every edit there. "Everywhere" means
 * every project whose own history says so; a borrowed row wants a person to
 * look at it on its own screen. A refused row has no evidence at all; a row
 * a person already ruled on keeps that ruling; a suppressed or contradicted
 * row stands behind another rule. Each is returned in `skipped` with its
 * status and why, so nothing is left out silently. Operators the rule was
 * never mined for get nothing: there is no row to carry the support.
 */
export function adjudicateEverywhere(
  store: Store,
  ruleId: string,
  verdict: ReviewVerdict,
  opts: Omit<NonNullable<Parameters<typeof adjudicate>[3]>, 'scope'> & { corpus: string },
): { marked: Rule[]; skipped: Array<{ scope: string; status: RuleStatus; borrowed?: boolean; support: Rule['support'] }> } {
  const rows = store.prepare('SELECT scope FROM rules WHERE id = ? AND corpus = ? ORDER BY scope').all(ruleId, opts.corpus) as Array<{ scope: string }>;
  if (!rows.length) throw new Error(`no rule ${ruleId} in ${opts.corpus}`);
  const marked: Rule[] = [];
  const skipped: Array<{ scope: string; status: RuleStatus; borrowed?: boolean; support: Rule['support'] }> = [];
  const at = opts.at ?? Date.now();
  // All or nothing: a JF4.3 refusal on the first row is a refusal on every
  // row (the conditions are the rule's, not the row's), and a half-applied
  // "everywhere" would be the one state a reviewer could not tell from the page.
  store.exec('BEGIN');
  try {
    for (const { scope } of rows) {
      const r = loadRule(store, ruleId, scope, opts.corpus)!;
      if (r.status !== 'proposed' || r.provenance.kind !== 'own') {
        skipped.push({ scope, status: r.status, support: r.support, ...(r.status === 'proposed' ? { borrowed: true } : {}) });
        continue;
      }
      marked.push(adjudicate(store, ruleId, verdict, { ...opts, scope, at }));
    }
    store.exec('COMMIT');
  } catch (e) {
    store.exec('ROLLBACK');
    throw e;
  }
  return { marked, skipped };
}

export function adjudications(store: Store, ruleId?: string, scope?: string, corpus?: string): Adjudication[] {
  const where: string[] = [];
  const args: string[] = [];
  if (ruleId) {
    where.push('rule_id = ?');
    args.push(ruleId);
  }
  if (scope !== undefined) {
    where.push('scope = ?');
    args.push(scope);
  }
  if (corpus !== undefined) {
    where.push('corpus = ?');
    args.push(corpus);
  }
  const rows = store
    .prepare(`SELECT * FROM adjudications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at`)
    .all(...args) as Array<{ rule_id: string; corpus: string; scope: string; at: number; verdict: ReviewVerdict; note: string | null; reviewer: string | null; support_holds: number; support_of: number }>;
  return rows.map((r) => {
    const a: Adjudication = { ruleId: r.rule_id, corpus: r.corpus, scope: r.scope, at: r.at, verdict: r.verdict, support: { holds: r.support_holds, of: r.support_of } };
    if (r.reviewer) a.reviewer = r.reviewer;
    if (r.note) {
      // A narrowing is stored as JSON {note, condition}; anything that does not
      // parse to that shape is a free-text note, however it starts.
      let parsed: { note?: string; condition?: Condition } | undefined;
      if (r.note.startsWith('{')) {
        try {
          const p = JSON.parse(r.note) as { note?: string; condition?: Condition };
          if (p && typeof p === 'object' && p.condition && typeof p.condition.fact === 'string') parsed = p;
        } catch {
          parsed = undefined;
        }
      }
      if (parsed) {
        if (parsed.note) a.note = parsed.note;
        if (parsed.condition) a.condition = parsed.condition;
      } else a.note = r.note;
    }
    return a;
  });
}

/** Conditions reviewers asked for on `narrowed` rules of this corpus — fed to the next mine. */
export function pendingNarrowings(store: Store, corpus: string): Array<{ pattern: string; bindings: Record<string, string>; window: Window; condition: Condition; parentId: string }> {
  const out: Array<{ pattern: string; bindings: Record<string, string>; window: Window; condition: Condition; parentId: string }> = [];
  for (const r of loadRules(store, { corpus, status: ['narrowed'] })) {
    for (const a of adjudications(store, r.id, r.scope, r.corpus)) {
      if (a.verdict === 'narrowed' && a.condition) out.push({ pattern: r.pattern, bindings: r.bindings, window: r.window, condition: a.condition, parentId: r.id });
    }
  }
  return out;
}

/** Median seconds between consecutive verdicts by the same reviewer — F5.4, measured, not estimated. */
export function reviewPace(store: Store): { verdicts: number; medianSeconds: number | null } {
  const all = adjudications(store);
  const gaps: number[] = [];
  const byReviewer = new Map<string, Adjudication[]>();
  for (const a of all) {
    const k = a.reviewer ?? '';
    let l = byReviewer.get(k);
    if (!l) byReviewer.set(k, (l = []));
    l.push(a);
  }
  for (const list of byReviewer.values()) {
    for (let i = 1; i < list.length; i++) {
      const gap = (list[i]!.at - list[i - 1]!.at) / 1000;
      // A gap over ten minutes is a break, not a rule.
      if (gap > 0 && gap <= 600) gaps.push(gap);
    }
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2]! : (gaps[gaps.length / 2 - 1]! + gaps[gaps.length / 2]!) / 2) : null;
  return { verdicts: all.length, medianSeconds: median };
}
