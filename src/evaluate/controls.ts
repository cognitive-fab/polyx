// The τ²-bench confounder controls (TS §9.4, FS §6.2). The agent that produced
// a generated corpus was handed its policy in the prompt, so recall there is
// partly circular. Two controls, both in code rather than in a caveat:
//
//   1. recall reported a second time over the clauses VIOLATED AT LEAST ONCE
//      in the corpus — a clause never violated is trivially recoverable and
//      says little;
//   2. failed and abandoned trajectories are included, and their share is
//      reported, so nobody can quietly evaluate on the successes.
//
// Both are computed from the corpus itself, on the evaluation side, so they
// apply to any corpus — ABCD included, where "violated at least once" is
// simply a property of the humans.
import { type InstanceRef, type LoadedCorpus } from '@cognitive-fab/polyx-lens';
import { GOOD_OUTCOMES } from '../mine/recommend.ts';
import { exerciseClauses, type ClauseExercise } from '@cognitive-fab/polyx-lens';
import type { Policy } from './policies/index.ts';

// The clause checker is the lens's engine, not the evaluator's: checking a
// written rule against a corpus needs no mining, and the free half of the
// product is exactly that capability. Re-exported here so the evaluation side
// keeps one import path.
export { exerciseClauses, type ClauseExercise };
import { THRESHOLDS, type Thresholds } from '@cognitive-fab/polyx-lens';
import { ref, sample } from '../mine/support.ts';


export interface Controls {
  /** Clauses exercised at least once and violated at least once — the honest recall denominator on a prompted corpus. */
  violatedAtLeastOnce: string[];
  /**
   * Clauses this corpus exercised enough times and KEPT at or above the
   * own-evidence floor — the rules the operator actually follows.
   *
   * Recall over the written policy conflates two very different misses: a rule
   * polyx failed to find, and a rule the agents do not keep (which polyx is
   * right to withhold, and which the diff reports as a compliance gap). This
   * denominator separates them. It is a DIAGNOSTIC, never the headline: the
   * product claim is about recovering the written policy, and shrinking the
   * denominator until the number looks good is the failure this whole harness
   * exists to avoid.
   */
  keptAtOwnSupport: string[];
  /** Expressible clauses the corpus never exercised at all. */
  neverExercised: string[];
  /** Share of interactions whose outcome is not `resolved` — failed and abandoned trajectories, kept in. */
  failedShare: { failed: number; of: number; value: number | null };
  exercise: ClauseExercise[];
}

export async function controls(corpus: LoadedCorpus, policy: Policy, t: Thresholds = THRESHOLDS): Promise<Controls> {
  const exercise = await exerciseClauses(corpus, policy.clauses);
  const withOutcome = corpus.interactions.filter((i) => i.outcome);
  const failed = withOutcome.filter((i) => !GOOD_OUTCOMES.has(i.outcome!.label)).length;
  return {
    violatedAtLeastOnce: exercise.filter((e) => e.violated > 0).map((e) => e.clauseId),
    keptAtOwnSupport: exercise.filter((e) => e.exercised >= t.minInstances && (e.exercised - e.violated) / e.exercised >= t.ownSupport).map((e) => e.clauseId),
    neverExercised: exercise.filter((e) => e.exercised === 0).map((e) => e.clauseId),
    failedShare: { failed, of: withOutcome.length, value: withOutcome.length ? failed / withOutcome.length : null },
    exercise,
  };
}

