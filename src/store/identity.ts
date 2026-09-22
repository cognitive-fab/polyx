// Rule identity (TS §7.5).
//
//   id = hash(family, pattern, canonicalised bindings, canonicalised conditions, window)
//
// Deliberately EXCLUDES support figures, so re-mining an unchanged corpus
// yields the same ids and adjudications survive (F4.3, F5.2). Adding
// interactions changes support, not identity. Changing the alphabet changes
// the bindings' vocabulary and therefore should change identity — which is
// correct, because it is a different rule about a differently-defined event.
import { createHash } from 'node:crypto';
import { type Condition, type RuleFamily, type Window } from '@cognitive-fab/polyx-lens';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface IdentityInput {
  family: RuleFamily;
  pattern: string;
  bindings: Record<string, string>;
  conditions: Condition[];
  window: Window;
}

/** Stable JSON: object keys sorted at every depth, arrays in order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Conditions are a set: order is not identity. */
export function canonicalConditions(conditions: Condition[]): Condition[] {
  return conditions
    .map((c) => ({ ...c, value: Array.isArray(c.value) ? [...c.value].sort() : c.value }))
    .sort((a, b) => cmp(canonicalJson(a), canonicalJson(b)));
}

export function ruleId(input: IdentityInput): string {
  const payload = canonicalJson({
    family: input.family,
    pattern: input.pattern,
    bindings: input.bindings,
    conditions: canonicalConditions(input.conditions),
    window: input.window,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
