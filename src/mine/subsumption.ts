// Redundancy pruning by subsumption (TS §7.2) — required, not optional.
// Declarative discovery emits hundreds of true, useless constraints; a rule
// implied by other proposed rules is suppressed and RECORDED as suppressed,
// so the count of what was pruned is itself a figure the audit can show.
//
// Two implications are mechanical enough to trust:
//
//   1. no-X-without-prior-Y (interaction)  ⇐  X-implies-prior-Y (episode)
//      An episode is inside its interaction; a guard found in the episode
//      was found in the contact.
//   2. X-implies-prior-Y  ⇐  X-implies-prior-Z  ∧  Z-implies-prior-Y
//      Transitivity, within one window, under the same conditions.
//   3. exactly-one-Y-per-X  ⇐  X-implies-prior-Y
//      "Exactly once" is "at least once" plus "at most once"; the first half
//      is the implies rule, and the second is at-most-one-Y's to state if Y
//      ever repeats. Kept only when the implies rule is not proposed.
//   4. no-X-without-prior-Y  ⇐  no-X-without-prior-Y-same-S with guards {Y}
//      "Read this file first" is "read a file first" and more. A guard SET
//      implies no single-guard rule, and there is only ever one set per
//      subject and slot (see the first pass in index.ts), so there is no
//      same-slot rule for another to imply.
//
// Anything subtler — co-existence, absence — is left to the reviewer.
import { type Condition, type Window } from '@cognitive-fab/polyx-lens';
import { canonicalJson } from '../store/identity.ts';
import { SAME_SLOT, splitGuards } from './patterns.ts';
export interface Prunable {
  id: string;
  pattern: string;
  bindings: Record<string, string>;
  conditions: Condition[];
  window: Window;
}

const key = (r: Prunable) => canonicalJson({ c: r.conditions, w: r.window });

/** ruleId → the rule ids that imply it. Only rules in `proposed` may suppress. */
export function subsumed(proposed: Prunable[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const implies = proposed.filter((r) => r.pattern === 'X-implies-prior-Y');
  const bySubject = new Map<string, Prunable[]>();
  for (const r of implies) {
    const k = `${key(r)}|${r.bindings.subject}`;
    let l = bySubject.get(k);
    if (!l) bySubject.set(k, (l = []));
    l.push(r);
  }
  const find = (subject: string, guard: string, k: string) => bySubject.get(`${k}|${subject}`)?.find((r) => r.bindings.guard === guard);
  const sameSlot = proposed.filter((r) => r.pattern === SAME_SLOT);
  const narrower = (r: Prunable, test: (guards: string[]) => boolean) =>
    sameSlot.find((s) => s.id !== r.id && s.bindings.subject === r.bindings.subject && key(s) === key(r) && test(splitGuards(s.bindings.guards)));

  for (const r of proposed) {
    if (r.pattern === 'no-X-without-prior-Y') {
      const ep = find(r.bindings.subject!, r.bindings.guard!, canonicalJson({ c: r.conditions, w: 'episode' }));
      if (ep) out.set(r.id, [ep.id]);
      else {
        const s = narrower(r, (g) => g.length === 1 && g[0] === r.bindings.guard);
        if (s) out.set(r.id, [s.id]);
      }
    } else if (r.pattern === 'exactly-one-Y-per-X') {
      const ep = find(r.bindings.subject!, r.bindings.guard!, key(r));
      if (ep) out.set(r.id, [ep.id]);
    } else if (r.pattern === 'X-implies-prior-Y') {
      const k = key(r);
      const { subject, guard } = r.bindings as { subject: string; guard: string };
      for (const mid of bySubject.get(`${k}|${subject}`) ?? []) {
        const z = mid.bindings.guard!;
        if (z === guard) continue;
        const second = find(z, guard, k);
        if (second) {
          out.set(r.id, [mid.id, second.id]);
          break;
        }
      }
    }
  }
  return out;
}
