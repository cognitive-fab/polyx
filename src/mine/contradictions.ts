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
import { SAME_SLOT, splitGuards } from './patterns.ts';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface Contradiction {
  /** The operator whose proposed set holds both rules. */
  scope: string;
  a: string;
  b: string;
  reason: string;
}

const PRECEDENCE = new Set(['X-implies-prior-Y', 'no-X-without-prior-Y']);

/**
 * The single guard a precedence rule names, or undefined. A same-slot rule
 * with a guard SET is not half of a cycle: "edit requires a prior read or
 * write" and "write requires a prior edit" can both hold.
 */
function soleGuard(r: Prunable): string | undefined {
  if (PRECEDENCE.has(r.pattern)) return r.bindings.guard;
  if (r.pattern !== SAME_SLOT) return undefined;
  const g = splitGuards(r.bindings.guards);
  return g.length === 1 ? g[0] : undefined;
}

export function contradictions(rules: Prunable[], scope: string): Contradiction[] {
  const out: Contradiction[] = [];
  const index = new Map<string, Prunable>();
  const k = (r: Prunable, subject: string, guard: string) => canonicalJson({ p: r.pattern, c: r.conditions, w: r.window, subject, guard, s: r.bindings.slot ?? null });
  for (const r of rules) {
    const guard = soleGuard(r);
    if (guard === undefined) continue;
    index.set(k(r, r.bindings.subject!, guard), r);
  }
  const seen = new Set<string>();
  for (const r of rules) {
    const guard = soleGuard(r);
    if (guard === undefined) continue;
    const reverse = index.get(k(r, guard, r.bindings.subject!));
    if (!reverse || reverse.id === r.id) continue;
    const pair = [r.id, reverse.id].sort().join('|');
    if (seen.has(pair)) continue;
    seen.add(pair);
    out.push({
      scope,
      a: r.id,
      b: reverse.id,
      reason: `precedence cycle: ${r.bindings.subject} requires a prior ${guard}, and ${guard} requires a prior ${r.bindings.subject}${r.bindings.slot ? ` on the same ${r.bindings.slot}` : ''} — the first occurrence of either violates one of them`,
    });
  }
  return out.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));
}
