// The obligation pattern table (TS §7.2). Written as a TABLE rather than four
// code paths — each entry knows how to name itself, how to test an instance,
// and how to emit its predicate — so the predicate language stays a column
// (TS §1, rule 2).
//
//   polyx pattern            DECLARE                      window
//   X-implies-prior-Y        precedence(Y, X)             episode
//   no-X-without-prior-Y     precedence(Y, X)             interaction
//   at-most-one-X            absence2(X)                  episode
//   exactly-one-Y-per-X      co-existence + absence2(Y)   episode
//   no-X-without-prior-Y-same-S   precedence(Y, X) on one S   interaction
//
// The last is the only one that looks inside an event. Where the alphabet
// declares a slot an IDENTITY — `file` on reading and editing a file — the
// guard must have been about the same thing: not "read a file before you
// edit one", which any earlier read satisfies, but "read THIS file". It is
// measured over the contact, because the read that licenses an edit is
// routinely several prompts earlier: on the cc corpus a same-file read or
// write sat in the edit's own episode four times in ten, and in its session
// nine times in ten.
//
// A GUARD has to be a step — an action — never an utterance. "Every refund
// was preceded by the customer saying something" is true and useless: nobody
// can satisfy it deliberately and no gate could check it.
import { type Instance, type Subject, type Thresholds, type Window } from '@cognitive-fab/polyx-lens';
import { UNKNOWN_TYPE } from '@cognitive-fab/polyx-lens';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface PatternArgs {
  subject: string;
  guard?: string;
  /** Same-slot patterns only: any of these, carrying the subject's value of `slot`, satisfies the rule. */
  guards?: string[];
  slot?: string;
}

/** The identity slots the alphabet declares for an event type (`EventType.identity`). */
export type IdentityOf = (type: string) => readonly string[];

/** The one pattern whose guard is about the same thing as its subject. */
export const SAME_SLOT = 'no-X-without-prior-Y-same-S';

/**
 * A same-slot rule's guard set, as stored: `bindings.guards`, the types
 * sorted and joined by `|`. Kept out of `bindings.guard`, which every other
 * consumer reads as one type.
 */
export const joinGuards = (guards: readonly string[]): string => [...guards].sort(cmp).join('|');
export const splitGuards = (joined: string | undefined): string[] => (joined ? joined.split('|') : []);

/** Every guard type a rule names, whichever key it is stored under. */
export const guardTypes = (bindings: Record<string, string>): string[] => (bindings.guard ? [bindings.guard] : splitGuards(bindings.guards));

export interface GuardStat {
  type: string;
  n: number;
  share: number;
}

export interface Pattern {
  name: string;
  window: Window;
  perEpisode: boolean;
  needsGuard: boolean;
  candidates(subject: Subject, t: Thresholds, identity: IdentityOf): PatternArgs[];
  holds(args: PatternArgs): (i: Instance) => boolean;
  /** Below this share of instances the rule is a habit, not an obligation. */
  minSupport(t: Thresholds): number;
  /** A rule nothing in the corpus could ever have violated is not worth a reviewer's time. */
  vacuous?(args: PatternArgs, instances: Instance[]): boolean;
  /**
   * When the vacuity test is applied. `candidate` (the default) drops the rule
   * before it is ever proposed — right for `at-most-one`, whose test is a
   * property of the rule alone. `survivor` runs it last, over what is still
   * proposed after contradictions and subsumption, so a relational verdict
   * always wins: "contradicts X" and "implied by Y" name another rule and are
   * strictly more useful to a reader than "uninformative", and a contradicted
   * rule must stay contradicted because the diff reports it (F8.1).
   */
  vacuousWhen?: 'candidate' | 'survivor';
  /** What the suppression says. Defaults to {@link VACUOUS_EPISODE}. */
  vacuousReason?: string;
  text(args: PatternArgs, label: (type: string) => string): string;
  why(args: PatternArgs, label: (type: string) => string): string;
  predicate(args: PatternArgs): string;
}

/** Action types seen before the subject in the given window, ranked by share of instances. */
export function guardStats(instances: Instance[], subject: string, window: 'before' | 'sessionBefore'): GuardStat[] {
  const seen = new Map<string, number>();
  for (const i of instances) {
    for (const t of new Set(i[window].filter((e) => e.kind === 'action').map((e) => e.type))) {
      // A subject is never its own guard: over a long window an earlier
      // occurrence precedes a later one most of the time, and the rule that
      // falls out is real and entirely circular.
      if (t === subject || t === UNKNOWN_TYPE) continue;
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
  }
  return [...seen]
    .map(([type, n]) => ({ type, n, share: n / instances.length }))
    .sort((a, b) => b.share - a.share || b.n - a.n || cmp(a.type, b.type));
}

/** Alphabet ids are `[a-z0-9_:.${}-]`; quoting them anyway keeps the emitter honest about injection. */
const q = (s: string | string[]) => JSON.stringify(s);

/** The default suppression wording: the episode-window vacuity `at-most-one` asks. */
export const VACUOUS_EPISODE = 'vacuous: no episode in the corpus could have violated it';

/** The contact-window analogue — same question, over the window that rule is measured on. */
export const VACUOUS_CONTACT = 'uninformative: every contact that did this had already done the guard first, so no instance in the corpus could have violated it';

export const PATTERNS: Pattern[] = [
  {
    name: 'X-implies-prior-Y',
    window: 'episode',
    perEpisode: false,
    needsGuard: true,
    candidates: ({ type, instances }, t) =>
      guardStats(instances, type, 'before')
        .filter((g) => g.share >= t.guardSupport)
        .slice(0, t.maxGuardRules)
        .map((g) => ({ subject: type, guard: g.type })),
    holds:
      ({ guard }) =>
      (i) =>
        i.before.some((e) => e.type === guard),
    minSupport: (t) => t.impliesSupport,
    text: ({ subject, guard }, l) => `Before you ${l(subject)}, ${l(guard!)} — every time, in the same episode.`,
    why: ({ guard }, l) => `${l(guard!)} came first every time it mattered`,
    predicate: ({ subject, guard }) =>
      `(ep) => ep.events.every((e, i) => e.type !== ${q(subject)} || ep.events.slice(0, i).some((g) => g.type === ${q(guard!)}))`,
  },
  {
    name: 'no-X-without-prior-Y',
    window: 'interaction',
    perEpisode: false,
    needsGuard: true,
    candidates: ({ type, instances }, t) =>
      guardStats(instances, type, 'sessionBefore')
        .filter((g) => g.share >= t.guardSupport)
        .slice(0, t.maxGuardRules)
        .map((g) => ({ subject: type, guard: g.type })),
    holds:
      ({ guard }) =>
      (i) =>
        i.sessionBefore.some((e) => e.type === guard),
    // Measured across the whole contact, so the bar is own-evidence rather
    // than implication: "did you verify before you refunded" is a question
    // about a sitting, and a rule that holds 60% of the time is offered as a
    // decision, not a discovery.
    minSupport: (t) => t.ownSupport,
    /**
     * **The contact window's own vacuity test (rev. 11, corrected rev. 12).**
     * What this family asks is *establish Y once per sitting, then X is
     * allowed* — and that is a rule only where a sitting might not have
     * established Y before X at all. Where the guard already preceded the
     * subject every single time, nothing is being asked: no instance in the
     * corpus could have violated the rule, which is exactly the question
     * `at-most-one`'s vacuity test asks.
     *
     * This is what FS §10.5 was about. The pattern quietly assumes a contact
     * is a unit of work. On ABCD a contact is one conversation about one
     * subflow and the assumption holds; on the Claude Code corpus a contact is
     * a multi-hour session holding twenty tasks, every common step appears in
     * it somewhere, and *"at some point earlier in the contact you listed a
     * directory"* comes back at 324 of 324 — a fact about the length of the
     * sitting, not about anything the agent chose. The fix is not a threshold
     * on how long a contact may be: it is to require that the premise was ever
     * in question, which is exact and needs no floor.
     *
     * **The window has to be the measured one (rev. 12).** Rev. 11 tested
     * `sessionAll`, the whole contact including what came *after* the subject,
     * while the rule is measured over `sessionBefore`. That is not a vacuity
     * test: a contact whose guard occurred only after the subject counted as
     * "already contained the guard", so rules with real counter-examples were
     * dropped as uninformative — τ²'s address rule at 32 of 39, and 444 of the
     * 1,095 `cc` rules the test suppressed. Measured over the same window the
     * rule is measured over, vacuous ⟺ support is 1.0, and the `cc` guard that
     * motivated the test is still caught: it preceded the subject 324 of 324
     * times.
     */
    vacuous: ({ guard }, instances) => instances.every((i) => i.sessionBefore.some((e) => e.type === guard)),
    vacuousWhen: 'survivor',
    vacuousReason: VACUOUS_CONTACT,
    text: ({ subject, guard }, l) => `Before you ${l(subject)}, ${l(guard!)} — at some point earlier in the contact.`,
    why: ({ guard }, l) => `the contact had ${l(guard!)} somewhere before it, most of the time`,
    predicate: ({ subject, guard }) =>
      `(it) => it.events.every((e, i) => e.type !== ${q(subject)} || it.events.slice(0, i).some((g) => g.type === ${q(guard!)}))`,
  },
  {
    name: 'at-most-one-X',
    window: 'episode',
    perEpisode: true,
    needsGuard: false,
    candidates: ({ type }) => [{ subject: type }],
    holds:
      ({ subject }) =>
      (i) =>
        i.all.filter((e) => e.type === subject).length <= 1,
    minSupport: (t) => t.impliesSupport,
    vacuous: ({ subject }, instances) => !instances.some((i) => i.all.filter((e) => e.type === subject).length > 1),
    text: ({ subject }, l) => `${cap(l(subject))} at most once per episode.`,
    why: ({ subject }, l) => `a second ${l(subject)} in one episode is the shape of a retry that was really a duplicate`,
    predicate: ({ subject }) => `(ep) => ep.events.filter((e) => e.type === ${q(subject)}).length <= 1`,
  },
  {
    name: 'exactly-one-Y-per-X',
    window: 'episode',
    perEpisode: true,
    needsGuard: true,
    candidates: ({ type, instances }, t) =>
      guardStats(instances, type, 'before')
        .filter((g) => g.share >= t.impliesSupport)
        .filter((g) => instances.every((i) => i.all.filter((e) => e.type === g.type).length <= 1))
        .slice(0, t.maxGuardRules)
        .map((g) => ({ subject: type, guard: g.type })),
    holds:
      ({ guard }) =>
      (i) =>
        i.all.filter((e) => e.type === guard).length === 1,
    minSupport: (t) => t.impliesSupport,
    text: ({ subject, guard }, l) => `When you ${l(subject)}, ${l(guard!)} exactly once in that episode — not twice, and not never.`,
    why: ({ guard }, l) => `${l(guard!)} happened once per episode, never twice`,
    predicate: ({ subject, guard }) =>
      `(ep) => !ep.events.some((e) => e.type === ${q(subject)}) || ep.events.filter((e) => e.type === ${q(guard!)}).length === 1`,
  },
  {
    name: SAME_SLOT,
    window: 'interaction',
    perEpisode: false,
    needsGuard: true,
    /**
     * One candidate per identity slot, whose guard is a SET: every action
     * type that carries the same slot and came first on the same value often
     * enough to count (`minInstances`), best first, capped like guards are.
     *
     * A set because the norm this exists for has two ways to be met. Claude
     * Code will not edit a file it has neither read nor written, and on the
     * cc corpus a same-file read preceded 1,635 of 3,930 edits in the session
     * while a same-file read or whole write preceded 3,426. A read-only rule
     * would warn on every edit to a file the agent had just written — true to
     * the count and wrong about the world.
     *
     * The subject is never in its own set: an earlier edit of the file
     * "licensing" a later one is the circular rule `guardStats` refuses too.
     */
    candidates: ({ type, instances }, t, identity) => {
      const out: PatternArgs[] = [];
      for (const slot of identity(type)) {
        // Every instance must carry the value. One that does not can only be
        // counted as failing, which is the closed-world assumption.
        if (!instances.every((i) => i.event.slots[slot] !== undefined)) continue;
        const seen = new Map<string, number>();
        let covered = 0;
        for (const i of instances) {
          const v = i.event.slots[slot];
          const here = new Set(
            i.sessionBefore.filter((e) => e.kind === 'action' && e.type !== type && e.type !== UNKNOWN_TYPE && e.slots[slot] === v && identity(e.type).includes(slot)).map((e) => e.type),
          );
          if (here.size) covered++;
          for (const g of here) seen.set(g, (seen.get(g) ?? 0) + 1);
        }
        const guards = [...seen]
          .filter(([, n]) => n >= t.minInstances)
          .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
          .slice(0, t.maxGuardRules)
          .map(([g]) => g);
        if (!guards.length || covered / instances.length < t.guardSupport) continue;
        out.push({ subject: type, guards: guards.sort(cmp), slot });
      }
      return out;
    },
    holds: ({ guards, slot }) => {
      const set = new Set(guards);
      return (i) => {
        const v = i.event.slots[slot!];
        return v !== undefined && i.sessionBefore.some((e) => set.has(e.type) && e.slots[slot!] === v);
      };
    },
    // The contact window's bar, as for `no-X-without-prior-Y`. No vacuity
    // test: that one exists because a long contact makes "some directory was
    // listed earlier" trivially true, and "this very file was read earlier"
    // is never true by the length of the sitting.
    minSupport: (t) => t.ownSupport,
    text: ({ subject, guards, slot }, l) => `Before you ${l(subject)}, ${guards!.map(l).join(' or ')} — the same ${slot}, earlier in the contact.`,
    why: ({ guards, slot }, l) => `the same ${slot} had been through ${guards!.map(l).join(' or ')} first, most of the time`,
    predicate: ({ subject, guards, slot }) =>
      `(it) => it.events.every((e, i) => e.type !== ${q(subject)} || it.events.slice(0, i).some((g) => ${q(guards!)}.includes(g.type) && g.slots[${q(slot!)}] === e.slots[${q(slot!)}]))`,
  },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
