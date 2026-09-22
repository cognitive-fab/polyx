# polyx x Jev - Functional and Technical Specification

*Integration of a System One model as an observation port. Rev. 1, 19 September 2026.*

Companion to `polyx-functional-spec.md` (FS) and `polyx-technical-spec.md` (TS).
Requirement ids here are prefixed `JF` (functional) and `JT` (technical) so they
do not collide with the `F*` and `A*` ids of those documents. Where this
document constrains existing behaviour it cites the existing id.

---

## 1. Purpose

TS A8.1 makes the advisor three-valued: a condition is true, false, or unknown,
and a fact absent from the request is unknown rather than false. That semantics
is the product. It is also the source of the largest single loss in coverage:
polyx abstains with `unknown_fact` whenever a rule's antecedent mentions
something nobody wrote down as a typed slot.

`runtime-gap-brief.md` section 5 measures the same loss on the other side of the
pipeline. Of eight quotable "load X before doing Y" instructions in the `cc`
corpus, only three could be stated as a checkable precondition at all. The other
five depend on intent, on an argument's value, or on what a file contains. Those
five are not mined, not served, and not counted. They are dropped silently,
which the brief itself names as the thing a gate must not do.

Both losses have one shape. polyx can evaluate a predicate over *typed* state
and cannot evaluate a predicate over *text*. A System One model evaluates a
predicate over text and returns a calibrated number, which is exactly the
missing operation and nothing more than it.

**JF0.** Jev is integrated as an **observation port**: a function from
(text, declared predicate) to a `Scalar` fact, or to nothing. It is not a miner,
not an adjudicator, not a reasoner, and it never decides a verdict. Everything
downstream of the fact base is unchanged.

### 1.1 Non-goals

- No Jev call anywhere in the mining path (README standing rule). Section 5
  states how mining still benefits without one.
- No natural-language rule authoring. Jev emits no text and cannot explain
  itself; a predicate's wording is written by a person and reviewed.
- No replacement of the alphabet. Typing actions remains judgement work and
  remains the entire cost (runtime-gap-brief section 6).
- No dependency of the free half on a paid API. `polyx-lens` must build, audit
  and report with no network and no key.

---

## 2. Standing rules this integration must not break

Restated from `README.md` and TS, because each one constrains a design decision
below and the integration is only admissible if all five survive.

| # | rule | how it survives |
|---|---|---|
| 1 | No LLM call in the mining path. Same corpus + alphabet + thresholds yields an identical rule set. | Jev runs in a separate `annotate` pass whose output is frozen, digested and pinned in the manifest. Mining reads annotations as data, like the corpus. Section 5. |
| 2 | Nothing is served that a human has not adjudicated `real` (F6.4). | A predicate is an artefact under review exactly as a rule is. An unadjudicated predicate emits no fact. Section 4.3. |
| 3 | Closed-world assumption is prohibited (TS A8.1). | A predicate below its assertion band emits **nothing**. It never emits `false`. Section 4.2, and the invariant in section 6. |
| 4 | No module outside `src/ports/polyness/` imports a polyness symbol. | The analogous rule for Jev, enforced by the same `check:boundary` script. Section 7.1. |
| 5 | The front half is Apache-2.0 and self-contained. | The port *interface* goes in `polyx-lens`; the Jev *adapter* goes in `polyx` (BUSL-1.1). The free half keeps a null implementation and never makes a network call. Section 7.1. |

A sixth rule is added by this integration:

**JF0.1.** No customer text leaves the machine unredacted. The alphabet's
redaction (TS A5.3) runs before any text reaches the port, and a corpus whose
redaction is not declared cannot be annotated. Section 7.7.

---

## 3. Measurements that constrain the design

Measured 19 September 2026 against `jev-latest`, 45 calls, 78 questions, from a
Windows host. Harness in the `jev-lab` checkout beside this one. These are not context;
each one decides a requirement below.

| observation | value | what it constrains |
|---|---|---|
| p50 round trip | 208 ms | JT5: one call per decision point, never one per predicate |
| latency vs. question count | flat (1 question 208 ms, 8 questions 164 ms) | JT5: batch the whole predicate set; fan-out is free |
| probability quantum | 0.01 | JT4: band arithmetic |
| jitter across identical calls | +/- 0.01 (0.20/0.21 over 6 calls; 0.09/0.10/0.11 over 12) | JT4 band separation, JT7 caching. **Jev output is not bit-stable.** |
| `choice` on multi-intent input | single label at 0.98-1.00, other intents dropped silently | JT2: `noul` only. `choice` is prohibited. |
| `noul` battery on the same input | recovers the dropped intents at no extra cost | JT2 |
| battery of 8 rules | 164 ms, 499 in / 148 out tokens | section 8: the check can sit in the hot path |
| no text output, ever | - | JF7: Jev can supply a fact, never a witness. polygraph supplies the witness. |

The jitter is the load-bearing measurement. It means a Jev call is not a pure
function of its input, so any path that must reproduce byte-for-byte has to read
a **recorded** answer rather than make a call. That single fact produces the
architecture in sections 5 and 7.7.

---

## 4. Functional requirements

### 4.1 Predicates are declared artefacts (JF1)

**JF1.1.** A predicate is declared in `alphabets/predicates.<corpus>.yaml`,
reviewed, versioned and committed, under the same discipline as the alphabet
(FS 5.2). It is never constructed at runtime and never generated by a model.

**JF1.2.** A predicate declares, as a minimum: an id, the **fact name** it
produces, the **question text** given to the model, the **source** of the text
it reads (which part of the record), its **bands**, and its **calibration
record**. Schema in JT2.

**JF1.3.** A predicate's fact name is namespaced `obs.<name>` so that an
observed fact is distinguishable from an adapter slot (`slot.*`) and from a
caller-supplied fact, everywhere it appears: in a rule's condition, in the
`missing` list of an abstention, and in the decision log.

**JF1.4.** Changing a predicate's question text, source or bands increments the
predicate-set version. Annotations produced under an earlier version are not
read under a later one. This mirrors `alphabetVersion` in the manifest.

### 4.2 Three-valued output, never closed-world (JF2)

**JF2.1.** A predicate maps a returned probability `p` to one of three results:

```
p >= assertAt            ->  emit fact obs.<name> = true
p <= refuteAt            ->  emit fact obs.<name> = false
otherwise                ->  emit NOTHING
```

**JF2.2.** "Emit nothing" means the key is absent from the fact base, so
`evalCondition` returns `unknown` and the advisor abstains with `unknown_fact`
exactly as it does today. The middle band is the model saying it does not know,
and polyx's existing vocabulary for that is abstention. Nothing new is needed
to express it.

**JF2.3.** `refuteAt` MAY be set to a value no probability can reach
(a negative number), which makes the predicate assert-only. An assert-only
predicate can never contribute a `false` and therefore can never cause a rule to
be skipped. This is the required setting for any predicate whose `false` would
be read as "it did not happen" rather than "the text says it did not happen".
The distinction is the closed-world prohibition, restated at the predicate
level, and it is the reviewer's judgement to make per predicate.

**JF2.4.** A predicate MUST NOT be declared over a question whose negation is
an absence. "Does this text state that income was verified?" is admissible,
assert-only. "Was income verified?" is not admissible at all, because Jev reads
the text and the text is not the world.

### 4.3 A predicate is calibrated before it is used (JF3)

**JF3.1.** A predicate is inert until it has a calibration record. An
uncalibrated predicate emits no fact, in every path, and `polyx audit` reports
it as declared-but-inert.

**JF3.2.** Calibration is measured against a labelled sample drawn from the
corpus the predicate will be used on. The reviewer labels; the model does not.
Minimum sample is `minCalibration` (default 60), with at least 15 of each label.

**JF3.3.** The calibration record stores, per predicate: sample size, the label
counts, the observed distribution of `p` on each label, the chosen bands, and
the resulting assert precision, refute precision, and withheld fraction. Bands
are **derived from that distribution**, never set by hand and never defaulted.

**JF3.4.** A predicate whose assert precision is below `minPredicatePrecision`
(default 0.90) on its calibration sample cannot be adjudicated `real`. The
review page shows the number and the reviewer decides; the tool does not rule.

**JF3.5.** Recalibration is required when the predicate-set version changes, the
alphabet version changes, or the corpus revision changes. A stale calibration
makes the predicate inert rather than trusted.

### 4.4 Adjudication (JF4)

**JF4.1.** A predicate carries a status on the same lattice as a rule:
`proposed`, `real`, `not_real`, `retired`. Only `real` emits facts. This is
F6.4 applied one level down, and for the same reason: a predicate is a claim
about the corpus that a person has to accept.

**JF4.2.** The review surface for a predicate shows the question, the bands, the
calibration distribution, and twenty sampled items with their `p` values,
including every item that fell in the withheld band. The withheld items are the
ones that tell a reviewer whether the band is drawn where the samples are, so they are not optional.

**JF4.3.** A rule whose antecedent mentions `obs.<name>` cannot be adjudicated
`real` while that predicate is not `real`. The dependency is checked at
adjudication time and named in the error.

### 4.5 Where facts enter (JF5)

**JF5.1.** Observed facts enter in exactly two places, and nowhere else:

- the **annotation pass** (section 5), which writes them into a frozen store
  that the miner reads as data;
- the **advisor**, at `factsAt()`, which merges them into the fact base for one
  request.

**JF5.2.** An observed fact MUST NOT overwrite a fact supplied by the caller or
derived from an adapter slot. The caller knows its own state better than a model
reading a transcript of it. Precedence: caller `facts` > `slot.*` > `obs.*`.

**JF5.3.** The advisor's behaviour with an empty observation set MUST be
byte-identical to its behaviour today. Observation is additive.

---

## 5. The annotation pass, and why mining stays reproducible

The standing rule is "no LLM call in the mining path". The rule exists so that
the same corpus, alphabet and thresholds yield the same rule set byte for byte.
Section 3 shows a Jev call is not bit-stable, so calling it during mining would
break that guarantee outright, not merely bend it.

The resolution is to move the call out of the mining path entirely and treat its
output as corpus data.

**JF6.1.** `polyx annotate <corpus>` runs every `real`, calibrated predicate
over the corpus once, and writes
`.polyx/annotations/<corpus>@<predicateSetVersion>.jsonl`. One line per
(interaction, episode, seq, predicate) with the raw `p`, the emitted fact or
`null`, the predicate-set version, and the redaction profile used.

**JF6.2.** The annotation file is hashed. `annotationDigest` and
`predicateSetVersion` join `corpusRevision` and `alphabetVersion` in the run
manifest (TS section 11). A figure carrying an `annotationDigest` is
reproducible by anyone holding that annotation file, with no key and no network.

**JF6.3.** The miner reads annotations from the store. It never calls the port.
`check:boundary` enforces this: no module under `src/mine/` may import the
observation port or the Jev adapter.

**JF6.4.** Given a fixed annotation file, mining remains byte-for-byte
reproducible. The guarantee is unchanged in form; it now has one more pinned
input, exactly as `corpusRevision` is a pinned input today.

**JF6.5.** `polyx annotate` is explicit and never implicit. No other command
makes a network call. `mine`, `audit`, `evaluate` and `diff` run offline against
whatever annotations exist, and report the predicate-set version they used.
A corpus with no annotation file mines exactly as it does today.

### 5.1 What mining gains

An annotated corpus carries `obs.*` facts alongside its `slot.*` facts, so the
existing conditioned-rule machinery mines over them with no change: a rule can
now be conditioned on "the request text states a reason" where previously it
could only be conditioned on a typed slot. The five instructions in
`runtime-gap-brief.md` section 5 that could not be stated as a checkable
precondition become checkable to the extent that a reviewed predicate can
observe them, and the ones that remain unobservable are reported rather than
dropped. Section 10 makes that the falsification test.

### 5.2 Re-annotation

**JF6.6.** Re-annotating an unchanged corpus with an unchanged predicate set
produces a different file, because `p` jitters. The digest changes, so the
manifest changes, so a figure is not silently altered under a reader's feet.
Re-annotation is therefore a deliberate act with its own run id, and the
previous annotation file is retained. `polyx annotate --diff` reports how many
emitted facts changed, which is the drift measurement and is expected to be
near zero if the bands are separated per JT4.

---

## 6. The safety invariant

This is the part that makes the integration defensible to a bank, and it follows
from the advisor's existing semantics rather than from anything Jev promises.

Let `F` be the fact base the advisor builds today and `O` the observed facts.
By JF5.2 the two are disjoint: observation only ever adds keys.

Under `evalCondition`, a condition over a key already in `F` is unaffected by
adding keys. Therefore:

- a rule that evaluates **true** under `F` still evaluates true under `F + O`;
- a rule that evaluates **false** under `F` still evaluates false;
- only a rule that was **unknown** can move, and it moves to true or false.

The set of firing rules is therefore monotonically non-decreasing. Because
`warnings` and `cleared` are both derived from obligations that evaluate true,
and whether a true obligation warns depends on the episode's event types rather
than on facts:

**JF7.1 (no warning is withdrawn).** For every request, every warning raised
without observation is also raised with observation. Observation can add a
warning. It can never remove one.

**JF7.2 (no abstention is created).** `missing` is monotonically
non-increasing. A decision point answered without observation is never turned
into an abstention by observation.

**JF7.3 (verdicts move one way).** Ordering verdicts `abstain < clear <
recommend < warn`, the verdict under `F + O` is greater than or equal to the
verdict under `F`. Observation moves the advisor toward caution and toward
answering, never away from either.

**JF7.4.** JF7.1 to JF7.3 are enforced by a property test (section 9, JT9.3)
run over the synthetic corpus with a randomised observation set, not merely
asserted here.

The practical reading: switching observation on can surface a warning that was
previously hidden behind an unknown fact, and can convert an abstention into an
answer. It cannot cause polyx to stay silent where it used to speak, and it
cannot cause polyx to bless an action it used to warn about. A reviewer who
distrusts a predicate can therefore adopt it without re-validating the rules
that were already working, which is what makes incremental adoption possible.

**JF7.5.** The invariant holds only while JF5.2 holds. An observed fact that
overwrote a caller fact could flip a true condition to false and withdraw a
warning. This is why precedence is a MUST and not a default.

---

## 7. Technical specification

### 7.1 Port placement and the licence boundary (JT1)

The arrangement mirrors the polyness port exactly, with one deliberate
difference.

```
polyx-lens/  (Apache-2.0)
  src/ports/observation.ts     the interface + the null implementation
polyx/       (BUSL-1.1)
  src/ports/jev/
    client.ts                  HTTP, retry, budget
    observer.ts                Observer implementation
    predicates.ts              predicate set loading and validation
    calibrate.ts               the calibration pass
```

The interface lives in `polyx-lens` because `Instance`, `Event` and `FactBase`
do, and because the free half has to be able to *read* an annotation file to
produce its compliance report. The adapter lives in `polyx` because it holds a
paid third-party dependency, and keeping it out of the front half means the
Apache-2.0 package makes no network call at all, under any configuration. That
is a cleaner statement than a promise, and it is checkable.

The difference from polyness: the null implementation is the **default**, not an
alternative. `polyx` with no `POLYX_JEV_KEY` behaves as it does today.

```ts
// polyx-lens/src/ports/observation.ts
export interface Observation {
  predicate: string;          // predicate id
  fact: string;               // 'obs.<name>'
  value: Scalar | null;       // null = withheld, NEVER false-by-absence
  p: number;                  // raw, retained for audit and recalibration
}

export interface Observer {
  readonly name: string;
  readonly version: number;   // predicate-set version
  /** One call per site. Implementations MUST batch every predicate into it. */
  observe(text: string, predicates: Predicate[]): Promise<Observation[]>;
}

export const nullObserver: Observer;   // returns [] for everything
```

**JT1.1.** No module outside `src/ports/jev/` may import a Jev symbol, or the
`typesafe` package, or reference `POLYX_JEV_KEY`. Add the rule to
`scripts/check-boundary.mjs` alongside the polyness rule.

**JT1.2.** No module under `src/mine/`, `src/evaluate/` or `src/diff/` may
import `Observer` at all. Those paths read annotations from the store.

### 7.2 predicates.<corpus>.yaml (JT2)

```yaml
version: 3
model: jev-latest
redaction: alphabet            # profile applied before text leaves the machine
predicates:
  - id: refund_reason_stated
    fact: obs.refund_reason_stated
    status: real
    source: event.text         # event.text | episode.text | slot.<name>
    window: event              # event | before | sessionBefore
    question: >
      Does this message state a reason for the refund?
    criteria:
      true:  A reason is stated.
      false: No reason is stated.
    bands:
      assertAt: 0.85
      refuteAt: -1             # assert-only (JF2.3)
    calibration:
      at: 2026-09-19
      corpusRevision: 9f2a1c4e8b70d331
      alphabetVersion: 7
      n: 74
      labels: { true: 41, false: 33 }
      assertPrecision: 0.95
      refutePrecision: null
      withheldFraction: 0.19
      reviewer: jjd
```

**JT2.1.** `type` is not a field. Every predicate is a `noul`. `choice` is
prohibited by section 3: it returns one label at high confidence while silently
discarding others, and a silently discarded intent is the failure mode polyx
exists to prevent. Where a set of alternatives is wanted, declare one
assert-only `noul` per alternative; section 3 shows the battery costs nothing.

**JT2.2.** `score` is prohibited in rev. 1. It returns a rubric position whose
meaning depends on the level wording, and polyx has no calibration story for an
ordinal yet. Revisit when a rule needs a graded condition.

**JT2.3.** `source` names where the text comes from. `event.text` is the single
event, `episode.text` the episode up to and including it. A predicate reading
`episode.text` is more expensive to recalibrate because any change to
segmentation changes its input, and the reviewer is told so on the review page.

**JT2.4.** A predicate with `status: real` and no `calibration` block fails
validation at load. Inert-by-omission is not permitted to look like configured.

### 7.3 The annotation store (JT3)

One line per (site, predicate), newline-delimited JSON, sorted by
`(interactionId, episodeId, seq, predicate)` so the file is stable and diffable.

```jsonc
{"i":"abcd-01840","e":"ep2","seq":7,"pred":"refund_reason_stated",
 "p":0.93,"fact":"obs.refund_reason_stated","value":true,
 "pv":3,"redaction":"alphabet@7","sha":"9c1f...","at":1758240000}
```

**JT3.1.** `sha` is `sha256` of the redacted text that was sent, truncated to
16 hex characters. It is the key of the text cache (JT5.2) and it is what lets a
reader confirm two sites shared one call.

**JT3.2.** `value` is `true`, `false`, or `null`. `null` is a recorded
withholding and MUST be written: a missing line and a withheld line mean
different things, and only the second says the predicate was asked.

**JT3.3.** `p` is retained for every line, including withheld ones. It is the
input to recalibration and to `annotate --diff`, and discarding it would make a
band change require a fresh pass over the corpus.

**JT3.4.** The file is append-only within a run and atomic across one: write to
a temporary path, digest, rename. A partial pass (JT8.5) is renamed with a
`.partial` marker and its digest is recorded as partial in the manifest.

**JT3.5.** `annotationDigest` is `sha256` over the file bytes, truncated to 16
characters, computed the same way as `corpusRevision` so the two read alike in a
manifest.

### 7.4 Band arithmetic (JT4)

Section 3 measured a quantum of 0.01 and a jitter of one quantum. Bands have to
be set so that jitter cannot change an emitted fact.

**JT4.1.** `assertAt` and `refuteAt` are multiples of 0.01.

**JT4.2.** Calibration MUST reject a band whose boundary sits within 0.02 of a
mode of the observed distribution. A boundary drawn through a cluster of samples
converts jitter directly into flapping facts, and the drift measured by
`annotate --diff` will show it.

**JT4.3.** `assertAt - refuteAt >= 0.20` for any predicate that is not
assert-only. A narrow withheld band is a closed-world assumption wearing a
threshold.

**JT4.4.** Comparisons are `p >= assertAt` and `p <= refuteAt`, computed on the
value as returned. No rounding, no rescaling, no averaging of repeated calls.
Repeating a call to reduce jitter is prohibited: it costs latency, it does not
converge on a true value, and it makes the annotation pass non-reproducible in a
way the digest cannot express.

### 7.5 Batching (JT5)

**JT5.1.** One call per site, carrying every predicate whose `source` and
`window` resolve to the same text. Latency is flat in the number of questions
(section 3), so the batch is free and the per-predicate call is pure waste.

**JT5.2.** The annotation pass groups by resolved text across the whole corpus
and calls once per distinct text, keyed by `sha256(text)`. Repeated texts in a
corpus (templated agent messages are common) collapse to one call.

**JT5.3.** Concurrency is bounded by `jevConcurrency` (default 4) with
exponential backoff on 429 and 529. The pass reports calls made, calls saved by
the text cache, wall time and token usage, and writes them into the manifest.

### 7.6 The advisor seam (JT6)

One function changes. `factsAt()` in `src/serve/advisor.ts` gains an optional
observation set, merged at the lowest precedence:

```ts
export function factsAt(req: AdviseRequest, obs: Observation[] = []): FactBase {
  const facts: FactBase = {};
  for (const o of obs) if (o.value !== null) facts[o.fact] = o.value;   // lowest
  for (const e of req.episode.events)
    for (const [k, v] of Object.entries(e.slots ?? {})) facts[`slot.${k}`] = v;
  Object.assign(facts, req.facts ?? {});                                // highest
  // ... episode.intent as today
  return facts;
}
```

**JT6.1.** The merge order in that function is the whole of JF5.2, and JF7.5
says the invariant depends on it. It carries a comment saying so, and a test
named for it.

**JT6.2.** `Advisor.advise` is unchanged. The observation set is resolved by the
HTTP layer before the call, so the advisor stays synchronous and pure, and
`coverage.ts` replay stays a pure function of the corpus plus the annotation
file.

### 7.7 Redaction and egress (JT7)

Annotation sends customer text to a third party. On the BPIC and any bank corpus
this is the requirement that decides whether the integration is usable at all.

**JT7.1.** The alphabet's redaction (TS A5.3) runs before text reaches the port.
The redaction profile id is written into every annotation line, so an annotation
made under a weaker profile is identifiable after the fact.

**JT7.2.** A corpus with no declared redaction profile cannot be annotated.
Failing closed, with a message naming the corpus.

**JT7.3.** `polyx annotate --dry-run` writes the exact redacted payloads to
`.polyx/annotations/<corpus>.preview.jsonl` and sends nothing. This is the
artefact a compliance reviewer reads before a key is ever configured, and it
should be produced before the first real run on any customer corpus.

**JT7.4.** Redaction and observation pull against each other: a predicate about
an amount cannot read a redacted amount. Where the two conflict the redaction
wins and the predicate is declared unobservable for that corpus, recorded as
such, and reported by `audit`. It is not worked around.

**JT7.5.** An on-premises or VPC deployment of the model removes JT7.1 to JT7.4
as blockers and nothing else in this document changes. Worth asking TypeSafe
about before the first bank conversation, because for that corpus it is likely to be
the first question rather than a later one.

### 7.8 Determinism and replay (JT8)

**JT8.1.** `polyx coverage` and `polyx evaluate` MUST NOT call the port. They
read the annotation file. A replay that called a model would produce a different
figure on each run, and the figures in `docs/results.json` are quoted publicly.

**JT8.2.** The live `serve` path MAY call the port. A live decision is not a
replay and jitter costs nothing there, because the bands are separated per JT4.

**JT8.3.** Every live observation is written to the decision log with its `p`,
the predicate id and the predicate-set version. The log is therefore a
progressively growing annotation file for live traffic, which is what lets a
live period be replayed later without a key. This is the same recorded-answer
pattern as JF6.1, applied to traffic rather than to a corpus.

**JT8.4.** With `POLYX_JEV_KEY` unset, or the API unreachable, or the budget
exhausted, `serve` falls back to the null observer. The consequence is an
abstention where an answer might have been available, which is the correct
failure direction and needs no special handling. It is logged as
`observer: null` so a period of degraded coverage is visible rather than
mistaken for a change in the corpus.

**JT8.5.** `jevBudget` caps calls per run. On exhaustion the pass stops, writes
what it has, and marks the annotation file partial. A partial file is usable:
unannotated sites simply carry no `obs.*` facts and abstain as today.

### 7.9 CLI surface (JT9)

```
polyx predicates <corpus>                  list, with status and calibration age
polyx predicates <corpus> --show <id>      question, bands, distribution, samples
polyx calibrate <corpus> <id>              label a sample, derive bands, write record
polyx annotate <corpus>                    the frozen pass (JF6.1)
polyx annotate <corpus> --dry-run          redacted payloads, no egress (JT7.3)
polyx annotate <corpus> --diff             drift against the previous annotation file
polyx review <corpus> serve                gains a predicate tab (JF4.2)
polyx audit <corpus>                       gains: declared, inert, unobservable counts
polyx coverage <corpus>                    gains: answered-by-observation split
```

**JT9.1.** `audit` reports three counts that did not exist before: predicates
declared, predicates inert (uncalibrated or stale), and conditions in `real`
rules that mention an `obs.*` fact no `real` predicate produces. The third is a
broken dependency and is an error.

**JT9.2.** `coverage` splits `answered` into answered-without-observation and
answered-because-of-observation, and reports the delta in both directions of the
invariant: abstentions resolved, and warnings newly raised. Those two numbers
are the yield of the integration and are the only ones worth quoting.

**JT9.3.** Required tests:

- `factsAt` precedence, one test per pair (JT6.1).
- Property test over the synthetic corpus: for a random subset of observations,
  assert JF7.1, JF7.2 and JF7.3 hold for every decision point.
- Null observer equivalence: `coverage synthetic` with observation disabled is
  byte-identical to today's output (JF5.3).
- Band rejection: a calibration whose boundary sits within 0.02 of a mode fails
  (JT4.2).
- Boundary check: a Jev import from outside `src/ports/jev/` fails CI (JT1.1).
- Annotation replay: `evaluate` run twice against one annotation file produces
  identical output, with the network disabled on the second run (JT8.1).
- Redaction: a corpus with no profile refuses to annotate (JT7.2).

**JT9.4.** `test/fixtures/synthetic` gains a planted observable rule: a rule
whose antecedent is only satisfiable through an `obs.*` fact, with its
annotation file committed. It is the oracle for the whole path, in the same
spirit as the existing planted-rule fixture, and it runs offline.

---

## 8. The experiment this has to pass

FS 6.5 asks what would falsify the approach. The same question is asked here,
and the answer is a number that already exists.

`runtime-gap-brief.md` section 5: of eight quotable "load X before doing Y"
instructions in the `cc` corpus, **three** could be stated as a checkable
precondition. Five could not, because they depend on intent, on an argument's
value, or on what a file contains.

**The experiment.** Write one predicate per unobservable instruction, calibrate
each against a labelled sample from the `cc` corpus, and count how many become
checkable at an assert precision of 0.90 or better.

| outcome | reading |
|---|---|
| 4 or 5 of 5 become checkable | the observation port closes most of the gap; proceed to a customer corpus |
| 2 or 3 of 5 | worth having, and the boundary between the two groups is itself a finding worth writing up |
| 0 or 1 of 5 | the gap is not a text-observation gap. Stop, and say so. |

**JF8.1.** The instructions that remain unobservable are reported by name with
the reason, not dropped. That is the whole argument of the runtime-gap brief and
it applies to this integration before anything else.

**JF8.2.** The secondary figure is on `abcd`: decision points currently
abstaining with `unknown_fact`, and how many resolve. `coverage` already reports
`missingFacts` ranked by count, so the predicates worth writing first are
already named by the existing tooling. Start there rather than guessing.

**JF8.3.** Neither figure is quotable without its manifest, including
`annotationDigest` and `predicateSetVersion`.

---

## 9. What this does not do

- **No witness.** Jev returns no text, so an observed fact can never explain
  itself. A rule that fires on an `obs.*` fact shows the reviewer the question,
  the `p` and the source text; it cannot show a reason, because there is none to
  show. Where a governance record needs a witness, it comes from polygraph.
- **No help with the alphabet.** Typing actions with a declared consequence is
  still judgement work and still the entire cost.
- **No sequence reasoning.** Jev evaluates a predicate over one text. Every
  ordering property, which is the thing polyx is actually about, is mined and
  evaluated exactly as it is today.
- **Not a security control.** This addresses the 188, not the 156
  (runtime-gap-brief section 2). A predicate reading a poisoned text will
  observe what the poison says.
- **No claim of calibration.** TypeSafe claims calibrated probabilities. This
  specification does not rely on that claim: bands are derived per predicate
  from a labelled sample on the corpus in use, which is a local measurement and
  holds whether or not the global claim does.

---

## 10. Risks

| risk | severity | mitigation |
|---|---|---|
| A predicate drifts as the vendor updates `jev-latest`, silently changing facts. | high | Pin the model id in the predicate set, not `-latest`, once TypeSafe exposes dated ids. Until then `annotate --diff` is the detector and recalibration on drift is mandatory (JF3.5). |
| Predicates proliferate and nobody recalibrates. | high | Stale calibration makes a predicate inert (JF3.5), so the failure is loss of coverage rather than a wrong answer. `audit` reports inert counts. |
| A reviewer sets bands to raise coverage. | medium | Bands are derived from the calibration distribution and the boundary rule JT4.2 rejects the obvious moves. `coverage` reports the withheld fraction alongside, so a narrowed band is visible as a coverage jump with no precision gain. |
| Egress blocks adoption at a bank. | medium | JT7.3 produces the reviewable artefact before any key exists; JT7.5 is the deployment answer, and is a question for TypeSafe now rather than later. |
| Vendor dependency in the commercial half. | medium | The port is the whole surface. A second System One implementation, or a local classifier, drops in behind the same interface. Nothing above `Observer` knows the vendor. |
| The integration becomes the story and the mining does not. | medium | JF8 is the gate. If observation does not close a measured gap it does not ship, regardless of how well it demonstrates. |
| Cost at corpus scale. | low | 499 in / 148 out tokens for a battery of 8, one call per distinct text (JT5.2), and a budget cap (JT8.5). |

---

## 11. Sequence

Each step is usable on its own and none of them is a rewrite. The port interface
and the null observer land first so that everything after is additive.

1. `Observer` + `nullObserver` in `polyx-lens`, boundary rules in CI, null
   equivalence test. Nothing behaves differently.
2. `predicates.<corpus>.yaml` loader and validator, `polyx predicates`.
3. `polyx calibrate`, the calibration record, JT4 band arithmetic.
4. `polyx annotate` with `--dry-run` first, then egress, then the digest in the
   manifest.
5. Miner reads annotations. Conditioned rules over `obs.*`.
6. `factsAt` precedence and the property test for JF7.
7. Live path in `serve`, decision-log observations, fallback.
8. Run the JF8 experiment on `cc`, then `abcd`.

Step 8 is the decision point. Steps 1 to 4 are worth doing anyway: a dry-run
annotation preview over a customer corpus is a compliance artefact whether or
not any predicate is ever adjudicated real.

---

## 12. Revision log

**Rev. 1, 19 September 2026.** Written against polyx at `src/serve/advisor.ts`
as of this date, and against measurements of `jev-latest` taken the same day
(section 3, harness in the `jev-lab` checkout). Open: whether TypeSafe
offers dated model ids or a VPC deployment, both of which change section 10 and
one of which changes section 7.7.
