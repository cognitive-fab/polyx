// Support (TS §7.1): holds / of, over instances, with the instances that
// fail — a rule presented without its counter-examples is a defect (F5.1).
//
// `perEpisode` collapses the denominator to distinct episodes. A whole-episode
// invariant like "at most one refund" is a statement about an episode, so
// counting it once per occurrence punishes a duplicate twice: ten episodes,
// one of which refunded three times, would score 9/12 rather than 9/10 and
// fall below the floor in exactly the case the rule exists to catch.
import { type Instance, type Support } from '@cognitive-fab/polyx-lens';
import { ref, sample } from '@cognitive-fab/polyx-lens';
export { ref, sample };

export interface Measured extends Support {
  passing: Instance[];
  failing: Instance[];
}

export function measure(instances: Instance[], holds: (i: Instance) => boolean, { perEpisode = false } = {}): Measured {
  let chosen = instances;
  if (perEpisode) {
    const byEpisode = new Map<string, Instance>();
    for (const i of instances) {
      const prev = byEpisode.get(i.episodeId);
      // One exemplar per episode, and a failing one wins so the episode is
      // counted once as a violation rather than once per occurrence.
      if (!prev || (holds(prev) && !holds(i))) byEpisode.set(i.episodeId, i);
    }
    chosen = [...byEpisode.values()];
  }
  const passing: Instance[] = [];
  const failing: Instance[] = [];
  for (const i of chosen) (holds(i) ? passing : failing).push(i);
  return { holds: passing.length, of: chosen.length, passing, failing };
}
