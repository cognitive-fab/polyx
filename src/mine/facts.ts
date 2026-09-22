// The candidate data conditions drawn from an instance's fact base (F4.1,
// TS §7.2 — the data-aware Declare extension). The fact base itself is
// record-level and lives in the lens; this is the part that only a miner needs.
//
// Four sources, in a fixed vocabulary:
//   obs.<name>              an observed fact, read from the annotation store — never from a model call
//   customer.* / order.*   the interaction's facts — what the agent had on screen
//   episode.intent          the one classified intent in the episode, if there is exactly one
//   slot.<name>             a categorical slot value seen earlier in the same episode
//
// Redaction surrogates (`h#…`, `<slot>#…`) are never condition values: a
// rule conditioned on a hash is a rule nobody can read or satisfy.
import { type Condition, type FactBase, type Scalar, type Thresholds } from '@cognitive-fab/polyx-lens';
import { instanceFacts } from '@cognitive-fab/polyx-lens';
import { cmp } from '@cognitive-fab/polyx-lens';

export { instanceFacts };

/**
 * Up to this many conditioned variants one base rule may emit on its
 * preferred fact. A fact's cardinality is not itself a bar: ABCD's
 * `episode.intent` takes 55 values, and one rule per flow is what a written
 * policy looks like. Identifiers are kept out by the surrogate filter and
 * the per-value instance floor, not by counting values.
 */
export const MAX_CONDITION_VALUES = 64;

/**
 * Every `fact = value` worth trying: the fact is categorical over the
 * instances, and the value occurs at least `minInstances` times — a condition
 * that selects fewer instances than the floor cannot support a rule anyway.
 */
export function candidateConditions(facts: FactBase[], t: Thresholds): Condition[] {
  const values = new Map<string, Map<Scalar, number>>();
  for (const f of facts) {
    for (const [k, v] of Object.entries(f)) {
      let m = values.get(k);
      if (!m) values.set(k, (m = new Map()));
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  const out: Condition[] = [];
  for (const [fact, m] of [...values].sort(([a], [b]) => cmp(a, b))) {
    // A fact with one value across every instance is a constant, and a
    // condition on a constant selects everything. An OBSERVED fact is the
    // exception, and the reason is in what absence means. An assert-only
    // predicate (JF2.3) emits `true` or nothing — its fact never takes a
    // second value — so under the rule above it could never be a candidate,
    // and section 5.1 of the spec would be unreachable. But an absent
    // `obs.*` is not silence the way an absent slot is: the predicate was
    // ASKED at that site and withheld (JT3.2 records it), or the site had no
    // text to ask about. Either way the condition does not hold there, so
    // present-versus-absent partitions the instances, and that is all a
    // candidate needs. Kept to `obs.*` so nothing about slot mining moves.
    const present = [...m.values()].reduce((a, b) => a + b, 0);
    const partitions = m.size >= 2 || (fact.startsWith('obs.') && present < facts.length);
    if (!partitions) continue;
    for (const [value, n] of [...m].sort(([a], [b]) => cmp(String(a), String(b)))) {
      if (n >= t.minInstances) out.push({ fact, op: 'eq', value });
    }
  }
  return out;
}
