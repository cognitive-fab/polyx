// Obligation synthesis for one subject (TS §7.2): every pattern candidate,
// measured; and where the plain rule fails its floor, the DATA-CONDITIONED
// variants that clear it — `precedence(disclose, quote) where product.type =
// 'mortgage'` — measured over the instances the condition selects.
//
// Three-valued at mining time as at serving time: an instance whose fact is
// UNKNOWN is neither in the numerator nor the denominator of a conditioned
// rule. Counting it as "condition false" would be the closed-world
// assumption the advisor forbids, arriving by the back door.
import { type Condition, type Instance, type Subject, type Thresholds, type Window } from '@cognitive-fab/polyx-lens';
import { evalCondition, renderCondition } from '@cognitive-fab/polyx-lens';
import { candidateConditions, instanceFacts, MAX_CONDITION_VALUES } from './facts.ts';
import { joinGuards, PATTERNS, type IdentityOf, type Pattern, type PatternArgs } from './patterns.ts';
import { measure, type Measured } from './support.ts';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface Candidate {
  pattern: Pattern;
  args: PatternArgs;
  bindings: Record<string, string>;
  conditions: Condition[];
  window: Window;
  holds: (i: Instance) => boolean;
  /** The instances the rule is measured over — all of the subject's, or the condition's selection. */
  instances: Instance[];
  measured: Measured;
  vacuous: boolean;
  /** Set when a reviewer's `narrowed` verdict asked for this variant. */
  parentId?: string;
  text: string;
  why: string;
  predicate: string;
}

export interface SynthesisContext {
  thresholds: Thresholds;
  label: (type: string) => string;
  /** Identity slots per event type, from the alphabet. Absent: none, and no same-slot rule is mined. */
  identity?: IdentityOf;
  /** Conditions a reviewer asked for on a parent rule (`narrowed`), keyed by the parent's bindings. */
  requested?: Array<{ pattern: string; bindings: Record<string, string>; window: Window; condition: Condition; parentId: string }>;
}

const ratio = (m: Measured) => (m.of === 0 ? 0 : m.holds / m.of);
const NO_IDENTITY: IdentityOf = () => [];

/** What a rule stores of its arguments. A same-slot rule's guard set and slot are part of what it says, so part of its id. */
function bindingsOf(args: PatternArgs): Record<string, string> {
  const b: Record<string, string> = { subject: args.subject };
  if (args.guard) b.guard = args.guard;
  if (args.guards) b.guards = joinGuards(args.guards);
  if (args.slot) b.slot = args.slot;
  return b;
}

function conditionedText(base: string, conditions: Condition[]): string {
  if (!conditions.length) return base;
  return `${base.replace(/\.$/, '')} — when ${conditions.map(renderCondition).join(' and ')}.`;
}

function conditionedPredicate(base: string, conditions: Condition[]): string {
  if (!conditions.length) return base;
  // The advisor evaluates conditions three-valued from structured data; the
  // emitted target carries them as a guard on a `facts` argument for gates
  // that consume the JS column directly.
  const guard = conditions.map((c) => `facts[${JSON.stringify(c.fact)}] === ${JSON.stringify(c.value)}`).join(' && ');
  return `(x, facts) => !(${guard}) || (${base})(x)`;
}

export function synthesise(subject: Subject, ctx: SynthesisContext): Candidate[] {
  const t = ctx.thresholds;
  const out: Candidate[] = [];
  const facts = new Map<Instance, ReturnType<typeof instanceFacts>>();
  const factsOf = (i: Instance) => {
    let f = facts.get(i);
    if (!f) facts.set(i, (f = instanceFacts(i)));
    return f;
  };

  for (const pattern of PATTERNS) {
    for (const args of pattern.candidates(subject, t, ctx.identity ?? NO_IDENTITY)) {
      const holds = pattern.holds(args);
      const bindings = bindingsOf(args);
      const base = measure(subject.instances, holds, { perEpisode: pattern.perEpisode });
      const vacuous = pattern.vacuous?.(args, subject.instances) ?? false;
      const text = pattern.text(args, ctx.label);
      const why = pattern.why(args, ctx.label);
      const predicate = pattern.predicate(args);
      const mk = (conditions: Condition[], instances: Instance[], measured: Measured): Candidate => ({
        pattern,
        args,
        bindings,
        conditions,
        window: pattern.window,
        holds,
        instances,
        measured,
        vacuous,
        text: conditionedText(text, conditions),
        why,
        predicate: conditionedPredicate(predicate, conditions),
      });
      out.push(mk([], subject.instances, base));

      // Conditioned variants: only where the plain rule fails its floor, and
      // only single conditions for obligations (conjunctions are the
      // recommendation family's search, TS §7.3).
      const requested = (ctx.requested ?? []).filter(
        (r) => r.pattern === pattern.name && r.window === pattern.window && r.bindings.subject === args.subject && r.bindings.guard === args.guard && r.bindings.guards === bindings.guards && r.bindings.slot === bindings.slot,
      );
      const tryConditions: Condition[] = requested.map((r) => r.condition);
      if (ratio(base) < pattern.minSupport(t)) {
        tryConditions.push(...candidateConditions(subject.instances.map(factsOf), t));
      }
      const tried = new Set<string>();
      const passing: Candidate[] = [];
      for (const c of tryConditions) {
        const ck = `${c.fact}=${String(c.value)}`;
        if (tried.has(ck)) continue;
        tried.add(ck);
        const selected: Instance[] = [];
        const complement: Instance[] = [];
        for (const i of subject.instances) {
          const truth = evalCondition(c, factsOf(i));
          if (truth === true) selected.push(i);
          else if (truth === false) complement.push(i);
          // unknown: in neither — three-valued at mining time too
        }
        if (selected.length < t.minInstances) continue;
        const m = measure(selected, holds, { perEpisode: pattern.perEpisode });
        const forcedBy = requested.find((r) => r.condition.fact === c.fact && r.condition.value === c.value);
        if (forcedBy) {
          const cand = mk([c], selected, m);
          cand.parentId = forcedBy.parentId;
          out.push(cand);
          continue;
        }
        if (ratio(m) < pattern.minSupport(t) || m.of < t.minInstances) continue;
        // The condition has to DISCRIMINATE: the rule must fail where the fact
        // is known and different. Otherwise it is not the value doing the
        // work but the fact being known at all — `order.packaging = yes` and
        // `order.packaging = no` both "explaining" a refund rule is the
        // signature of a fact that exists only in order flows.
        if (complement.length < t.minInstances) continue;
        const mc = measure(complement, holds, { perEpisode: pattern.perEpisode });
        if (ratio(mc) >= pattern.minSupport(t)) continue;
        passing.push(mk([c], selected, m));
      }
      // The episode's classified intent is the natural scope of a CRM
      // obligation — "in the refund flow, validate the purchase first" — so
      // intent conditions come first and are not capped: one rule per flow
      // is what a written policy looks like. Only when no intent explains the
      // rule do other facts get a turn, and then readable means few: the
      // conditions that explain the most instances, capped like guards are.
      const byIntent = passing.filter((c) => c.conditions[0]!.fact === 'episode.intent');
      if (byIntent.length) {
        byIntent.sort((a, b) => b.instances.length - a.instances.length || cmp(a.text, b.text));
        out.push(...byIntent.slice(0, MAX_CONDITION_VALUES));
      } else {
        passing.sort((a, b) => b.instances.length - a.instances.length || cmp(a.text, b.text));
        out.push(...passing.slice(0, t.maxGuardRules));
      }
    }
  }
  return out;
}

/** What identifies a candidate independently of where it was found. */
export interface CandidateSpec {
  pattern: Pattern;
  args: PatternArgs;
  conditions: Condition[];
  parentId?: string;
}

export const specKey = (s: { pattern: { name: string } | string; args: PatternArgs; conditions: Condition[] }): string =>
  `${typeof s.pattern === 'string' ? s.pattern : s.pattern.name}|${s.args.subject}|${s.args.guard ?? ''}|${s.args.guards ? joinGuards(s.args.guards) : ''}|${s.args.slot ?? ''}|${JSON.stringify(s.conditions)}`;

/**
 * Score a candidate found elsewhere against THESE instances (F4.4: a rule
 * without own evidence is never proposed, but may always be scored). Returns
 * undefined when the condition selects fewer instances than the floor —
 * there is nothing to measure, not a zero.
 */
export function scoreCandidate(spec: CandidateSpec, instances: Instance[], ctx: SynthesisContext): Candidate | undefined {
  const t = ctx.thresholds;
  const { pattern, args, conditions } = spec;
  const holds = pattern.holds(args);
  const bindings = bindingsOf(args);
  const selected = conditions.length ? instances.filter((i) => conditions.every((c) => evalCondition(c, instanceFacts(i)) === true)) : instances;
  if (selected.length < t.minInstances) return undefined;
  const measured = measure(selected, holds, { perEpisode: pattern.perEpisode });
  const cand: Candidate = {
    pattern,
    args,
    bindings,
    conditions,
    window: pattern.window,
    holds,
    instances: selected,
    measured,
    vacuous: pattern.vacuous?.(args, selected) ?? false,
    text: conditionedText(pattern.text(args, ctx.label), conditions),
    why: pattern.why(args, ctx.label),
    predicate: conditionedPredicate(pattern.predicate(args), conditions),
  };
  if (spec.parentId) cand.parentId = spec.parentId;
  return cand;
}
