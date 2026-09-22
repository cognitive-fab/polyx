// Alignment (TS §9.2, F8.3) — matching a mined rule to a policy clause. The
// weakest step in the system, and labelled as such everywhere its output
// appears: every alignment is a PROPOSAL for human confirmation.
//
// The matcher here is structural and deterministic. Both sides are typed —
// a rule is (subject, guard, conditions), a clause is (subject, guard, when)
// — so most correspondences are mechanical, and the ones that are not are
// marked `proposed` rather than guessed. An LLM-assisted matcher for the
// fuzzy remainder is a later column; the gold set (a person's confirmations)
// is what either matcher is scored against.
//
// Match kinds, strongest first:
//   exact     same subject and guard; the rule's condition names the clause's scope
//   general   same subject and guard; the rule is unconditioned (it claims more than the clause)
//   proposed  same subject and guard; the rule is conditioned on something the clause does not name
//
// A same-slot rule ("read THIS file first") states the clause's pair and
// more, so with a single guard it matches as the pair does. With a guard set
// ("read it or write it") it is weaker than a clause naming one of them, and
// is never better than `proposed`: a person decides whether "or write it" is
// what the clause meant.
import { readFileSync, existsSync } from 'node:fs';
import { type Rule } from '@cognitive-fab/polyx-lens';
import { parse } from 'yaml';
import type { Clause, Policy } from './policies/index.ts';
import { cmp } from '@cognitive-fab/polyx-lens';
import { SAME_SLOT, splitGuards } from '../mine/patterns.ts';

export type MatchKind = 'exact' | 'general' | 'proposed';

export interface Alignment {
  ruleId: string;
  scope: string;
  clauseId: string;
  kind: MatchKind;
}

const PRECEDENCE = new Set(['X-implies-prior-Y', 'no-X-without-prior-Y']);

/** Every (rule, clause) pair the structural matcher proposes. */
export function align(rules: Rule[], policy: Policy): Alignment[] {
  const out: Alignment[] = [];
  const byPair = new Map<string, Clause[]>();
  for (const c of policy.clauses) {
    if (c.shape !== 'precedence') continue;
    const k = `${c.subject}|${c.guard}`;
    let l = byPair.get(k);
    if (!l) byPair.set(k, (l = []));
    l.push(c);
  }
  // The scopes in which each subject is governed at all — so an unconditioned
  // rule that matches a pair stated in EVERY scope where the subject appears
  // is exact (it is the conjunction of those clauses), and one that matches a
  // pair stated in only some of them is general (it claims more).
  const scopesOfSubject = new Map<string, Set<string>>();
  for (const c of policy.clauses) {
    if (c.shape !== 'precedence' || !c.when) continue;
    let s = scopesOfSubject.get(c.subject!);
    if (!s) scopesOfSubject.set(c.subject!, (s = new Set()));
    s.add(String(c.when.value));
  }
  const atMostOne = new Map<string, Clause[]>();
  for (const c of policy.clauses) {
    if (c.shape !== 'at-most-one') continue;
    let l = atMostOne.get(c.subject!);
    if (!l) atMostOne.set(c.subject!, (l = []));
    l.push(c);
  }
  for (const r of rules) {
    if (r.family !== 'obligation') continue;
    if (r.pattern === 'at-most-one-X') {
      for (const c of atMostOne.get(r.bindings.subject!) ?? []) {
        const kind: MatchKind = r.conditions.length === 0 ? (c.when ? 'general' : 'exact') : c.when && r.conditions.some((x) => x.fact === c.when!.fact && x.value === c.when!.value) ? 'exact' : 'proposed';
        out.push({ ruleId: r.id, scope: r.scope, clauseId: c.id, kind });
      }
      continue;
    }
    if (r.pattern === SAME_SLOT) {
      const guards = splitGuards(r.bindings.guards);
      if (guards.length > 1) {
        for (const g of guards) for (const c of byPair.get(`${r.bindings.subject}|${g}`) ?? []) out.push({ ruleId: r.id, scope: r.scope, clauseId: c.id, kind: 'proposed' });
        continue;
      }
    } else if (!PRECEDENCE.has(r.pattern)) continue;
    const guard = r.pattern === SAME_SLOT ? splitGuards(r.bindings.guards)[0] : r.bindings.guard;
    const clauses = byPair.get(`${r.bindings.subject}|${guard}`) ?? [];
    const pairScopes = new Set(clauses.filter((c) => c.when).map((c) => String(c.when!.value)));
    const coversAll = pairScopes.size > 0 && pairScopes.size === (scopesOfSubject.get(r.bindings.subject!)?.size ?? -1);
    for (const c of clauses) {
      let kind: MatchKind;
      if (r.conditions.length === 0) kind = !c.when || coversAll ? 'exact' : 'general';
      else if (r.conditions.some((x) => c.when && x.fact === c.when.fact && x.op === 'eq' && x.value === c.when.value)) kind = 'exact';
      else if (c.when && r.conditions.some((x) => x.fact === c.when!.fact)) continue; // a different scope of the same fact: not this clause
      else kind = 'proposed';
      out.push({ ruleId: r.id, scope: r.scope, clauseId: c.id, kind });
    }
  }
  return out.sort((a, b) => cmp(a.ruleId, b.ruleId) || cmp(a.scope, b.scope) || cmp(a.clauseId, b.clauseId));
}

// ---------------------------------------------------------------------------
// Gold: what a person confirmed. `policies/<policy>-gold.yaml`:
//   pairs:
//     - { rule: <id>, clause: <id>, verdict: confirmed | rejected, rater: a }
//     - { rule: <id>, clause: <id>, verdict: rejected, rater: b }
// Two raters on the same pair give the inter-rater figure; the matcher's own
// agreement with the gold verdicts is reported as a known source of error.

export interface GoldPair {
  rule: string;
  clause: string;
  verdict: 'confirmed' | 'rejected';
  rater: string;
}

export function loadGold(file: string): GoldPair[] {
  if (!existsSync(file)) return [];
  const doc = parse(readFileSync(file, 'utf8')) as { pairs?: unknown[] };
  return ((doc?.pairs ?? []) as Array<Record<string, unknown>>).map((p, i) => {
    if (typeof p.rule !== 'string' || typeof p.clause !== 'string' || (p.verdict !== 'confirmed' && p.verdict !== 'rejected') || typeof p.rater !== 'string') {
      throw new Error(`${file}: pairs[${i}] needs rule, clause, verdict (confirmed|rejected), rater`);
    }
    return { rule: p.rule, clause: p.clause, verdict: p.verdict, rater: p.rater };
  });
}

export interface GoldReport {
  pairs: number;
  /** Pairs rated by two or more people. */
  doubleRated: number;
  /** Share of double-rated pairs where every rater agreed. */
  interRater: number | null;
  /** Share of gold-rated pairs where the matcher's proposal (matched or not) equals the majority verdict. */
  matcherAgreement: number | null;
  /** How many gold pairs the matcher never proposed at all. */
  matcherMissed: number;
}

export function goldReport(gold: GoldPair[], alignments: Alignment[]): GoldReport {
  const byPair = new Map<string, GoldPair[]>();
  for (const g of gold) {
    const k = `${g.rule}|${g.clause}`;
    let l = byPair.get(k);
    if (!l) byPair.set(k, (l = []));
    l.push(g);
  }
  const proposed = new Set(alignments.map((a) => `${a.ruleId}|${a.clauseId}`));
  let doubleRated = 0;
  let agreed = 0;
  let matcherRight = 0;
  let missed = 0;
  for (const [k, votes] of byPair) {
    const raters = new Set(votes.map((v) => v.rater));
    if (raters.size >= 2) {
      doubleRated++;
      if (new Set(votes.map((v) => v.verdict)).size === 1) agreed++;
    }
    const confirmed = votes.filter((v) => v.verdict === 'confirmed').length;
    const majority = confirmed * 2 >= votes.length;
    const matched = proposed.has(k);
    if (matched === majority) matcherRight++;
    if (!matched) missed++;
  }
  return {
    pairs: byPair.size,
    doubleRated,
    interRater: doubleRated ? agreed / doubleRated : null,
    matcherAgreement: byPair.size ? matcherRight / byPair.size : null,
    matcherMissed: missed,
  };
}
