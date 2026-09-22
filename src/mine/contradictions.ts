// Contradiction detection (F4.6). A pair of proposed rules that cannot both
// be satisfied by any episode containing their subject is reported, and
// neither is proposed.
//
// The one class the pattern table can produce mechanically is the precedence
// cycle: X requires a prior Y and Y requires a prior X, in the same window
// under the same conditions. The first occurrence of either violates one of
// them — both rules can hold at high support only when the corpus ping-pongs,
// which is exactly the shape the synthetic corpus plants.
import { canonicalJson } from '../store/identity.ts';
import type { Prunable } from './subsumption.ts';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface Contradiction {
  /** The operator whose proposed set holds both rules. */
  scope: string;
  a: string;
  b: string;
  reason: string;
}

const PRECEDENCE = new Set(['X-implies-prior-Y', 'no-X-without-prior-Y']);

export function contradictions(rules: Prunable[], scope: string): Contradiction[] {
  const out: Contradiction[] = [];
  const index = new Map<string, Prunable>();
  const k = (r: Prunable, subject: string, guard: string) => canonicalJson({ p: r.pattern, c: r.conditions, w: r.window, subject, guard });
  for (const r of rules) {
    if (!PRECEDENCE.has(r.pattern)) continue;
    index.set(k(r, r.bindings.subject!, r.bindings.guard!), r);
  }
  const seen = new Set<string>();
  for (const r of rules) {
    if (!PRECEDENCE.has(r.pattern)) continue;
    const reverse = index.get(k(r, r.bindings.guard!, r.bindings.subject!));
    if (!reverse || reverse.id === r.id) continue;
    const pair = [r.id, reverse.id].sort().join('|');
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({
      scope,
      a: r.id,
      b: reverse.id,
      reason: `precedence cycle: ${r.bindings.subject} requires a prior ${r.bindings.guard}, and ${r.bindings.guard} requires a prior ${r.bindings.subject} — the first occurrence of either violates one of them`,
    });
  }
  return out.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));
}
