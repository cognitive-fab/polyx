// Resolving observations for one live request (JT8.2, JT8.4). The HTTP
// layer calls this BEFORE the advisor, so `advise` stays synchronous and
// pure and the replay stays a function of the corpus plus the annotation
// file.
//
// The rules are the miner's rules, restated for a request instead of an
// instance. Every event the caller sent is "before" the considered action,
// so an observation on any of them applies; later events win, except that a
// withholding never retracts an emitted fact. The text is redacted under
// the corpus's profile before it goes anywhere, and one call carries every
// predicate that reads a given text — a battery is one call.
//
// It never throws. An unreachable observer, a budget spent, an observer
// that answered nonsense: each resolves to NO observations and a name that
// says so, because the consequence is an abstention where an answer might
// have been available, which is the correct failure direction and needs no
// special handling beyond being visible in the log.
import {
  activePredicates,
  emit,
  isStale,
  joinEpisodeText,
  redactText,
  type Observation,
  type Observer,
  type Predicate,
  type PredicateSet,
  type TextProfile,
} from 'polyx-lens';
import type { AdviseRequest } from './advisor.ts';

export interface LiveObservation {
  observer: Observer;
  set: PredicateSet;
  profile: TextProfile;
  /** What the predicates were calibrated against; a stale one is inert here as everywhere. */
  corpusRevision: string;
  alphabetVersion: number;
  /** Calls this process may make before falling back to the null observer (JT8.5, at serve time). Unbounded by default. */
  budget?: number;
}

export interface Resolved {
  /** Which observer actually answered: the configured one, or `null` when none did and why. */
  observer: string;
  version: number;
  obs: Observation[];
}

export class LiveObserver {
  private calls = 0;
  private failures = 0;
  private readonly predicates: Predicate[];
  private readonly live: LiveObservation;

  constructor(live: LiveObservation) {
    this.live = live;
    this.predicates = activePredicates(live.set).filter((p) => !isStale(p, live.corpusRevision, live.alphabetVersion));
  }

  /** The predicates that will actually be asked — for the startup line. */
  get active(): Predicate[] {
    return this.predicates;
  }

  get stats(): { calls: number; failures: number } {
    return { calls: this.calls, failures: this.failures };
  }

  async resolve(req: AdviseRequest): Promise<Resolved> {
    const version = this.live.set.version;
    const none = (why: string): Resolved => ({ observer: `null (${why})`, version, obs: [] });
    if (this.predicates.length === 0) return none('no real, calibrated predicate');
    if (this.live.budget !== undefined && this.calls >= this.live.budget) return none('budget spent');

    // Group predicates by the text each one reads at each event, redacted.
    const texts = new Map<string, { text: string; predicates: Predicate[]; order: number }>();
    const events = req.episode.events;
    const raw = events.map((e) => (typeof e.text === 'string' && e.text.trim() ? e.text : null));
    events.forEach((e, i) => {
      for (const p of this.predicates) {
        let t: string | null = null;
        if (p.source === 'event.text') t = raw[i] ?? null;
        else if (p.source === 'episode.text') t = joinEpisodeText(raw.slice(0, i + 1));
        else if (p.source.startsWith('slot.')) {
          const v = e.slots?.[p.source.slice(5)];
          t = v === undefined || v === null ? null : String(v);
        }
        if (t === null) continue;
        const redacted = redactText(t, this.live.profile);
        let g = texts.get(redacted);
        if (!g) texts.set(redacted, (g = { text: redacted, predicates: [], order: i }));
        if (!g.predicates.includes(p)) g.predicates.push(p);
        g.order = i; // later wins
      }
    });
    if (texts.size === 0) return none('no text in the request');

    const merged = new Map<string, Observation>();
    try {
      for (const g of [...texts.values()].sort((a, b) => a.order - b.order)) {
        if (this.live.budget !== undefined && this.calls >= this.live.budget) {
          // Mid-request exhaustion: keep what was answered, say the rest was not.
          this.failures++;
          break;
        }
        this.calls++;
        const answered = await this.live.observer.observe(g.text, g.predicates);
        for (const o of answered) {
          const p = g.predicates.find((x) => x.id === o.predicate);
          if (!p) continue;
          // Re-derive the fact from p through the declared bands, whatever the
          // observer said: the band arithmetic is the one place a probability
          // becomes a fact, and an observer is not trusted to have done it.
          const value = emit(o.p, p.bands);
          const prev = merged.get(p.fact);
          if (value !== null || !prev) merged.set(p.fact, { ...o, fact: p.fact, value });
        }
      }
    } catch (e) {
      this.failures++;
      return none(`unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { observer: this.live.observer.name, version, obs: [...merged.values()] };
  }
}
