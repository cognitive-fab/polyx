// Policy clause sets (TS §9.1) — the answer key, loaded on the evaluation
// side only. The boundary check keeps this module unreachable from mine/.
import { readFileSync } from 'node:fs';
import { type Scalar } from '@cognitive-fab/polyx-lens';
import { parse } from 'yaml';
export interface Clause {
  id: string;
  text: string;
  /** Can polyx's rule language state this at all? Counted in recall's denominator only when true. */
  expressible: boolean;
  reason?: string;
  shape?: 'precedence' | 'at-most-one';
  subject?: string;
  guard?: string;
  /**
   * The span the clause is measured over. **Part of what the clause SAYS**, not
   * a default: "read the file before editing it" is scoped by the Edit contract
   * to *this conversation*, while "review what is staged before committing" is
   * about the piece of work in hand.
   *
   * Absent means `episode`, which is the stricter reading and correct wherever
   * a contact holds one task — ABCD has one subflow per conversation and τ² one
   * scenario per simulation, so neither moves. On a corpus whose sessions hold
   * twenty tasks it is most of the answer.
   */
  window?: 'episode' | 'interaction';
  /**
   * Precedence clauses only: whether the policy lists the two actions next to
   * each other. A sequential policy is violated by doing E before A, so every
   * ordered pair is a clause — but they are not independent facts, so recall
   * is reported over both the all-pairs and the adjacent-only denominator
   * (human ruling on ABCD, 29 Aug 2026). Absent when the clause set does not
   * say, and then no adjacent-only figure is reported.
   */
  adjacent?: boolean;
  /** Absent = the clause holds everywhere. */
  when?: { fact: string; value: Scalar };
}

export interface Policy {
  policy: string;
  version: number;
  source?: string;
  clauses: Clause[];
}

export function parsePolicy(text: string, where = 'policy'): Policy {
  const doc = parse(text) as Record<string, unknown>;
  if (typeof doc?.policy !== 'string') throw new Error(`${where}: policy name is required`);
  if (!Number.isInteger(doc.version)) throw new Error(`${where}: version must be an integer`);
  if (!Array.isArray(doc.clauses)) throw new Error(`${where}: clauses must be a list`);
  const seen = new Set<string>();
  const clauses = (doc.clauses as Array<Record<string, unknown>>).map((c, i) => {
    const w = `${where}: clauses[${i}]`;
    if (typeof c.id !== 'string') throw new Error(`${w}: id is required`);
    if (seen.has(c.id)) throw new Error(`${w}: duplicate id ${c.id}`);
    seen.add(c.id);
    if (typeof c.text !== 'string') throw new Error(`${w}: text is required`);
    if (typeof c.expressible !== 'boolean') throw new Error(`${w}: expressible must be true or false`);
    const out: Clause = { id: c.id, text: c.text, expressible: c.expressible };
    if (typeof c.reason === 'string') out.reason = c.reason;
    if (c.shape === 'precedence') {
      if (typeof c.subject !== 'string' || typeof c.guard !== 'string') throw new Error(`${w}: precedence needs subject and guard`);
      out.shape = 'precedence';
      out.subject = c.subject;
      out.guard = c.guard;
    } else if (c.shape === 'at-most-one') {
      if (typeof c.subject !== 'string') throw new Error(`${w}: at-most-one needs a subject`);
      out.shape = 'at-most-one';
      out.subject = c.subject;
    } else if (c.shape !== undefined) throw new Error(`${w}: shape must be precedence | at-most-one`);
    else if (c.expressible) throw new Error(`${w}: an expressible clause needs a shape`);
    if (c.window !== undefined) {
      if (c.window !== 'episode' && c.window !== 'interaction') throw new Error(`${w}: window must be episode | interaction`);
      out.window = c.window;
    }
    if (c.adjacent !== undefined) {
      if (typeof c.adjacent !== 'boolean') throw new Error(`${w}: adjacent must be true or false`);
      out.adjacent = c.adjacent;
    }
    if (c.when !== undefined) {
      const wh = c.when as Record<string, unknown>;
      if (typeof wh.fact !== 'string' || wh.value === undefined) throw new Error(`${w}: when needs fact and value`);
      out.when = { fact: wh.fact, value: wh.value as Scalar };
    }
    return out;
  });
  const out: Policy = { policy: doc.policy, version: doc.version as number, clauses };
  if (typeof doc.source === 'string') out.source = doc.source;
  return out;
}

export function loadPolicy(file: string): Policy {
  return parsePolicy(readFileSync(file, 'utf8'), file);
}
