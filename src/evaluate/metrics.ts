// The headline figures (TS §9.3, FS §6.1):
//
//   precision            = |proposed rules aligned to a clause| / |proposed rules|
//   recall               = |expressible clauses recovered|      / |expressible clauses|
//   refusal_correctness  = |refused rules absent from the policy| / |refused rules|
//
// Each is reported strict (exact alignments only) and lenient (exact or
// general — an unconditioned rule that claims more than any one clause). The
// two numbers bracket the truth; the gold set (align.ts) is what decides it.
//
// Every figure carries the count of inexpressible clauses beside it, because
// "recovered 60% of the policy" and "recovered 60% of the third of the policy
// it can even represent" are different claims and only the second is honest.
import { type Rule } from '@cognitive-fab/polyx-lens';
import type { Alignment } from './align.ts';
import type { Policy } from './policies/index.ts';
import { SAME_SLOT } from '../mine/patterns.ts';

export interface Ratio {
  num: number;
  den: number;
  value: number | null;
}

const ratio = (num: number, den: number): Ratio => ({ num, den, value: den === 0 ? null : num / den });

export interface Metrics {
  proposed: number;
  refused: number;
  clauses: { total: number; expressible: number; inexpressible: number; expressibleAdjacent: number | null; byReason: Record<string, number> };
  precision: { strict: Ratio; lenient: Ratio; /** lenient, over rules whose shape a clause set can state at all */ alignable: Ratio };
  recall: { strict: Ratio; lenient: Ratio };
  /**
   * Recall again over the clauses the policy lists as consecutive steps —
   * null when the clause set does not mark adjacency. The all-pairs figure
   * counts transitively implied clauses that are not independent facts; this
   * one counts only the steps the policy states side by side. Neither is "the"
   * recall, which is why both are printed.
   */
  recallAdjacent: { strict: Ratio; lenient: Ratio } | null;
  refusalCorrectness: Ratio;
  /** Proposed rules no clause could match — the shape the policy does not state (at-most-one, …). */
  unalignable: number;
  /** Proposed rules with an alignment marked `proposed` only — a person must decide. */
  needsConfirmation: number;
}

/** Rule shapes a policy clause set can state at all. */
const ALIGNABLE = new Set(['X-implies-prior-Y', 'no-X-without-prior-Y', 'at-most-one-X', SAME_SLOT]);

export function metrics(allRules: Rule[], policy: Policy, alignments: Alignment[]): Metrics {
  // Policy conformance is a question about OBLIGATIONS. Recommendations are
  // measured against what was done and how it ended (agreement, outcome —
  // TS §7.3, `polyx coverage`), never against a policy that does not state them.
  const rules = allRules.filter((r) => r.family === 'obligation');
  const proposed = rules.filter((r) => r.status === 'proposed' || r.status === 'real' || r.status === 'not_real' || r.status === 'narrowed');
  const refused = rules.filter((r) => r.status === 'refused');
  const key = (r: Rule) => `${r.id}|${r.scope}`;
  const byRule = new Map<string, Alignment[]>();
  for (const a of alignments) {
    const k = `${a.ruleId}|${a.scope}`;
    let l = byRule.get(k);
    if (!l) byRule.set(k, (l = []));
    l.push(a);
  }
  const best = (r: Rule) => {
    const as = byRule.get(key(r)) ?? [];
    if (as.some((a) => a.kind === 'exact')) return 'exact';
    if (as.some((a) => a.kind === 'general')) return 'general';
    if (as.length) return 'proposed';
    return null;
  };

  let strictHits = 0;
  let lenientHits = 0;
  let unalignable = 0;
  let needsConfirmation = 0;
  for (const r of proposed) {
    const b = best(r);
    if (b === 'exact') strictHits++;
    if (b === 'exact' || b === 'general') lenientHits++;
    if (b === 'proposed') needsConfirmation++;
    if (b === null && !ALIGNABLE.has(r.pattern)) unalignable++;
  }

  const expressible = policy.clauses.filter((c) => c.expressible);
  const proposedKeys = new Set(proposed.map(key));
  const recoveredStrict = new Set<string>();
  const recoveredLenient = new Set<string>();
  for (const a of alignments) {
    if (!proposedKeys.has(`${a.ruleId}|${a.scope}`)) continue;
    if (a.kind === 'exact') recoveredStrict.add(a.clauseId);
    if (a.kind === 'exact' || a.kind === 'general') recoveredLenient.add(a.clauseId);
  }
  const expressibleIds = new Set(expressible.map((c) => c.id));
  const rs = [...recoveredStrict].filter((id) => expressibleIds.has(id)).length;
  const rl = [...recoveredLenient].filter((id) => expressibleIds.has(id)).length;
  const adjacentIds = new Set(expressible.filter((c) => c.adjacent === true).map((c) => c.id));
  const statesAdjacency = expressible.some((c) => c.adjacent !== undefined);
  const recallAdjacent = statesAdjacency
    ? {
        strict: ratio([...recoveredStrict].filter((id) => adjacentIds.has(id)).length, adjacentIds.size),
        lenient: ratio([...recoveredLenient].filter((id) => adjacentIds.has(id)).length, adjacentIds.size),
      }
    : null;

  // A refusal is correct when nothing in the policy states the refused rule
  // AS STATED: a global rule the policy scopes to some flows is not the
  // policy's rule, and refusing it is right.
  let correctRefusals = 0;
  for (const r of refused) {
    const as = byRule.get(key(r)) ?? [];
    if (!as.some((a) => a.kind === 'exact')) correctRefusals++;
  }
  const alignable = proposed.filter((r) => ALIGNABLE.has(r.pattern)).length;

  const byReason: Record<string, number> = {};
  for (const c of policy.clauses) if (!c.expressible) byReason[c.reason ?? 'unstated'] = (byReason[c.reason ?? 'unstated'] ?? 0) + 1;

  return {
    proposed: proposed.length,
    refused: refused.length,
    clauses: { total: policy.clauses.length, expressible: expressible.length, inexpressible: policy.clauses.length - expressible.length, expressibleAdjacent: statesAdjacency ? adjacentIds.size : null, byReason },
    precision: { strict: ratio(strictHits, proposed.length), lenient: ratio(lenientHits, proposed.length), alignable: ratio(lenientHits, alignable) },
    recall: { strict: ratio(rs, expressible.length), lenient: ratio(rl, expressible.length) },
    recallAdjacent,
    refusalCorrectness: ratio(correctRefusals, refused.length),
    unalignable,
    needsConfirmation,
  };
}

export const fmt = (r: Ratio): string => (r.value === null ? `n/a (${r.num}/${r.den})` : `${r.value.toFixed(3)} (${r.num}/${r.den})`);
