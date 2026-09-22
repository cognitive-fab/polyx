// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cognitive Fab LLC. This directory is licensed under the MIT
// License (see ./LICENSE), separately from the rest of polyx. See LICENSING.md.
//
// `polyx calibrate <corpus> <id>` (JF3, W3.1). A predicate is inert until a
// person has labelled a sample of the corpus it will be used on, and this is
// the machinery for that: draw the sample, hold the labels in a committed
// artefact, then derive the bands from what the model returned against what
// the person said.
//
// Three properties this file exists to preserve.
//
// THE REVIEWER LABELS, THE MODEL DOES NOT. The sample is drawn and rendered
// with no probability attached, and `p` is not written into the label file
// until every item has a verdict. The precedent is in this repository and it
// cost a measurement to learn: the gold surface once rendered a rule and a
// clause in different notation, and thirteen of fifteen near-miss pairs came
// back confirmed because the rater anchored on the field that matched. That
// was the instrument, not the rater. A labeller shown `p = 0.97` is being
// asked to agree, not to judge.
//
// THE SAMPLE IS DETERMINISTIC. Same corpus, same predicate, same seed, same
// items in the same order — so a second reviewer labels the same sample and
// the two can be compared, and so a recalibration after a band change does
// not quietly draw a different sample.
//
// THE MODEL IS CALLED ONCE PER ITEM, NOT ONCE PER LABEL. Sampling is parallel
// and output tokens are free, so the whole predicate battery rides one call
// per distinct text — the same rule the annotation pass obeys (JT5.1).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  calibrationRecord,
  deriveBands,
  isAssertOnly,
  redactText,
  textSourceFor,
  type Calibration,
  type LoadedCorpus,
  type Observed,
  type Observer,
  type Predicate,
  type TextProfile,
  type Thresholds,
} from 'polyx-lens';
import { resolveRaw } from '../../show.ts';

/** One drawn site, before anybody has said anything about it. */
export interface Site {
  interactionId: string;
  episodeId: string;
  seq: number;
  /** The redacted text the predicate reads. */
  text: string;
  /** sha256 of that text, truncated — the key a repeated text collapses on (JT3.1). */
  sha: string;
}

export interface LabelledSite extends Site {
  /**
   * What the REVIEWER said. Never what the model said.
   *
   * Three states, and the distinction between two of them matters: ABSENT is
   * not yet labelled; `null` is "I cannot tell from the text", which is a
   * verdict — and, in quantity, a finding about the question (JF2.4).
   */
  label?: boolean | null;
  /** What the model returned, filled in only after labelling is complete. */
  p?: number;
}

export interface LabelFile {
  corpus: string;
  predicate: string;
  question: string;
  predicateSetVersion: number;
  corpusRevision: string;
  alphabetVersion: number;
  seed: number;
  reviewer: string | null;
  items: LabelledSite[];
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * A deterministic shuffle keyed by (predicate, seed). Not cryptographic and
 * not trying to be: it only has to be stable across runs and independent of
 * corpus order, so that two reviewers see one sample and a re-draw after a
 * question is reworded is visibly the same draw.
 */
function ordering(keys: string[], salt: string): number[] {
  return keys
    .map((k, i) => ({ i, h: sha16(`${salt}\u0000${k}`) }))
    .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i))
    .map((x) => x.i);
}

/**
 * Every site in the corpus a predicate could read, with its text resolved
 * and REDACTED under the corpus profile.
 *
 * Redacted, because the labeller has to label what the model will be asked.
 * The annotation pass sends the redacted text; a label given against the
 * original would be a label for a different input, and on a corpus where the
 * redaction removes something the predicate needed, the mismatch would hide
 * exactly the failure calibration exists to find. It also means the label
 * file — a stored artefact — never holds a customer identifier.
 *
 * A site with no text is not a failure and is not sampled: an action turn
 * carries no utterance, and a predicate over `event.text` has nothing to say
 * about it. Those sites simply carry no `obs.*` fact and abstain as today.
 */
export function sitesFor(corpus: LoadedCorpus, predicate: Predicate, profile: TextProfile): Site[] {
  const source = textSourceFor(corpus.config.adapter);
  const out: Site[] = [];
  for (const it of corpus.interactions) {
    for (const e of it.events) {
      let text: string | null = null;
      if (predicate.source === 'event.text') {
        // No try/catch: a source file that has moved since ingestion is a
        // real failure, and a sample silently drawn from whatever still
        // resolves would be a sample of the wrong thing.
        text = source.text(resolveRaw(e.raw));
      } else if (predicate.source.startsWith('slot.')) {
        const v = e.slots[predicate.source.slice(5)];
        text = v === undefined || v === null ? null : String(v);
      }
      if (text === null || !text.trim()) continue;
      const redacted = redactText(text, profile);
      out.push({ interactionId: it.id, episodeId: e.episode, seq: e.seq, text: redacted, sha: sha16(redacted) });
    }
  }
  return out;
}

/**
 * Draw the calibration sample (JF3.2). Deterministic in `seed`, and drawn over
 * DISTINCT texts: labelling the same templated agent message forty times
 * produces forty labels and one item of evidence.
 */
export function drawSample(sites: Site[], predicate: Predicate, n: number, seed: number): Site[] {
  const byText = new Map<string, Site>();
  for (const s of sites) if (!byText.has(s.sha)) byText.set(s.sha, s);
  const distinct = [...byText.values()].sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const order = ordering(distinct.map((s) => s.sha), `${predicate.id}\u0000${seed}`);
  return order.slice(0, n).map((i) => distinct[i]!);
}

export function labelFileFor(workspace: string, corpus: string, predicate: string): string {
  return `${workspace}/labels/${corpus}.${predicate}.yaml`;
}

export function readLabelFile(file: string): LabelFile | null {
  if (!existsSync(file)) return null;
  return (parseYaml(readFileSync(file, 'utf8')) as LabelFile | null) ?? null;
}

export function writeLabelFile(file: string, lf: LabelFile): void {
  const header = [
    '# A calibration sample. THE REVIEWER LABELS; THE MODEL DOES NOT.',
    '#',
    '# Add `label` to each item: true if the answer to the question below is',
    '# yes for this text, false if it is no, null if you cannot tell from the',
    '# text alone. Read null as a finding, not a chore: a question you cannot',
    '# answer from the text is one the model cannot answer from it either',
    '# (JF2.4). An item with no label at all has not been looked at yet.',
    '#',
    `# ${lf.predicate}: ${lf.question.replace(/\s+/g, ' ').trim()}`,
    '#',
    '# `p` is absent until every item is labelled. That is deliberate: a',
    '# labeller who can see the model\'s answer is being asked to agree with it',
    '# rather than to judge the text.',
    '#',
    '# The text below is REDACTED under the corpus profile named in the',
    '# predicate set — it is exactly what the model will be asked, so a label',
    '# here is a label for the right input. It still should not leave the',
    '# machine: a profile is a claim, and the dry-run preview is how it is checked.',
    '',
  ].join('\n');
  writeFileSync(file, header + stringifyYaml(lf), 'utf8');
}

export interface CalibrateProgress {
  total: number;
  labelled: number;
  unsure: number;
  /** Labelled true / labelled false — the balance JF3.2 needs. */
  trueN: number;
  falseN: number;
}

export function progressOf(lf: LabelFile): CalibrateProgress {
  const answered = lf.items.filter((i) => i.label !== undefined);
  return {
    total: lf.items.length,
    labelled: answered.length,
    unsure: answered.filter((i) => i.label === null).length,
    trueN: answered.filter((i) => i.label === true).length,
    falseN: answered.filter((i) => i.label === false).length,
  };
}

/**
 * Ask the model about every labelled item, once per distinct text, and attach
 * the probabilities. Separated from derivation so the reviewer's labels are
 * final before any number arrives beside them.
 */
export async function measure(lf: LabelFile, predicate: Predicate, observer: Observer): Promise<LabelFile> {
  const items = [...lf.items];
  const byText = new Map<string, number>();
  for (const i of items) if (i.label === true || i.label === false) byText.set(i.text, 0);
  for (const text of byText.keys()) {
    const obs = await observer.observe(text, [predicate]);
    const o = obs.find((x) => x.predicate === predicate.id);
    // A null observer returns nothing, and that is not an error here: it is
    // the honest answer that no measurement was taken. `calibrate` reports it
    // rather than writing a record built on absent numbers.
    if (o) byText.set(text, o.p);
    else byText.delete(text);
  }
  return { ...lf, items: items.map((i) => (byText.has(i.text) ? { ...i, p: byText.get(i.text)! } : i)) };
}

export class CalibrationIncomplete extends Error {}

/** The observed distribution, from a fully labelled and measured file. */
export function observedFrom(lf: LabelFile): Observed {
  const out: Observed = { true: [], false: [] };
  let unsure = 0;
  for (const i of lf.items) {
    if (i.label === null) unsure++;
    if (i.p === undefined || i.label === null || i.label === undefined) continue;
    (i.label ? out.true : out.false).push(i.p);
  }
  if (unsure) out.unsure = unsure;
  return out;
}

export function deriveFrom(lf: LabelFile, predicate: Predicate, t: Thresholds, reviewer: string, corpus: LoadedCorpus): Calibration {
  const observed = observedFrom(lf);
  if (observed.true.length + observed.false.length === 0) {
    throw new CalibrationIncomplete(
      `no measurements for '${predicate.id}'. With no POLYX_JEV_KEY the observer is the null one, which returns nothing by design — the sample is labelled and waiting, and the numbers arrive when a key does.`,
    );
  }
  const d = deriveBands(predicate.id, observed, {
    minCalibration: t.minCalibration,
    minCalibrationPerLabel: t.minCalibrationPerLabel,
    minPredicatePrecision: t.minPredicatePrecision,
    minLabelSeparation: t.minLabelSeparation,
    assertOnly: isAssertOnly(predicate.bands),
  });
  return calibrationRecord(d, observed, {
    at: new Date().toISOString().slice(0, 10),
    corpusRevision: corpus.revision,
    alphabetVersion: corpus.alphabet.version,
    reviewer,
  });
}
