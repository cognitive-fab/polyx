# polyx x Jev — Implementation Plan

*Companion to `polyx-jev-integration-spec.md` (the spec). Rev. 1, 19 September 2026.*

The spec says what the integration must be. This says what has to be written, in
what order, and what stops each step from being started. It was produced by
reading the spec against the code as it stands at `d7ced9d`, and the first
section exists because five requirements in the spec name a capability polyx
does not have yet.

Requirement ids are the spec's (`JF*`, `JT*`). Work items here are `W*`.

---

## 1. Five gaps between the spec and the code

Each of these blocks a specific requirement. None is fatal; each changes the
shape of a step below, and three of them add work the spec does not budget for.
They are stated first because deciding them is cheaper than discovering them in
step 4.

### G1. There is no text in the canonical record. (blocks JT2.3, JF6.1)

`Event` (`polyx-lens/src/record.ts:50`) carries `seq`, `at`, `episode`, `kind`,
`type`, `slots`, `result` and `raw: RawRef`. There is no `text` field, and
`alphabet/redact.ts:11` states the reason as a design commitment: *"Free text is
never persisted at all, so this module only ever sees slots."*

The spec's `source: event.text | episode.text` therefore does not resolve
against anything. Text exists only at the far end of `raw`, a pointer into the
analyst's source file, followed today by exactly one module — `src/show.ts`,
whose header says *"Nothing else in polyx reads source content after
ingestion."*

**Resolution.** Annotation becomes the second reader of source content, and
that is a deliberate, stated exception rather than a drift. It needs a
**text-resolution port**: a function from an `Event` (plus its `RawRef`) to the
text a predicate reads, implemented per adapter, because only the adapter knows
which field of a raw record is the utterance. `W1.3` below.

Consequences the spec should absorb: annotation requires the corpus source
files to be present, `episode.text` is the concatenation of resolved event
texts in `seq` order, and a corpus whose adapter has no text resolver is
unannotatable and reported as such by `audit` alongside JT7.4's unobservables.

### G2. A single-valued `obs.*` fact can never be mined. (blocks section 5.1 — the entire mining gain)

`candidateConditions` (`src/mine/facts.ts:36`) skips any fact with fewer than
two distinct values:

```ts
for (const [fact, m] of [...values].sort(...)) {
  if (m.size < 2) continue;
```

An assert-only predicate — which JF2.3 makes the required setting for most
predicates — emits `true` or nothing. Across a corpus its fact takes exactly one
value, so it is dropped before the instance floor is ever consulted, and no rule
is ever conditioned on it. Section 5.1 of the spec is unreachable as the miner
stands.

**Resolution.** For `obs.*` facts specifically, absence is informative in a way
that absence of a slot is not: the predicate was *asked* and withheld (JT3.2
makes that a recorded fact, not an inference). Treat a recorded withholding as
a second value for candidacy purposes only, while still emitting nothing into
the fact base. Concretely: candidacy counts `obs.x = true` against
`obs.x = <withheld>`, the emitted condition remains `obs.x eq true`, and the
condition's support is measured over instances where the fact is present, which
is what `evalAll` already does. `W5.2`.

The alternative — allowing single-valued facts generally — would change mined
output on every existing corpus and is not admissible.

### G3. Redaction covers slots, not free text. (blocks JT7.1, JF0.1)

`RedactionConfig` is a list of `SlotRule` (keyed by slot name, strategies
`token`/`hash`/`drop`) and `PatternRule` (`email`/`phone`/`digits`). The slot
rules have no meaning over free text; only the pattern rules do, and they are
currently applied to string slot *values*.

**Resolution.** A **text redaction profile** is a new, separately declared
artefact: the pattern rules, applied over a text span, plus a declared
`textProfile` id written into every annotation line (JT7.1 already requires the
id). Reuse `PATTERNS` and the `token`/`hash` surrogates so a redacted name in
text and the same name in a slot produce the same surrogate — that is what
makes a predicate about a named entity possible at all. This is real work in
`polyx-lens` and it is a compliance artefact in its own right; `W4.1` puts it
before any egress, which is also the order JT7.3 wants.

### G4. The live request carries no text. (blocks JT8.2, JT8.3)

`AdviseRequest.episode.events` is `Array<Pick<Event,'type'> &
Partial<Pick<Event,'kind'|'slots'|'seq'>>>`. A live caller sends types and
slots. There is nothing for a predicate to read, so the live path cannot
observe anything, and JT6.2's "the observation set is resolved by the HTTP layer
before the call" has no input.

**Resolution.** Add an optional `text?: string` per event to `AdviseRequest`,
validated in `parseRequest`, redacted at the HTTP boundary under the corpus's
text profile before it reaches the port. Absent text means no observation,
which degrades to JT8.4's null-observer behaviour and needs no other handling.
`W7.1`.

### G5. `factsAt`'s merge order is not what the spec assumes. (JT6.1)

Today (`src/serve/advisor.ts:83`):

```ts
const facts: FactBase = { ...(req.facts ?? {}) };
if (intents.size === 1) facts['episode.intent'] = ...;
for (const e of req.episode.events) for (...) facts[`slot.${k}`] = v;   // last wins
```

`slot.*` currently **overwrites** a caller-supplied `slot.*` fact, and
`episode.intent` overwrites a caller-supplied one. The spec's JT6.1 sketch puts
caller facts highest, which is the right precedence and is what JF7.5 depends
on — but it is a behaviour change to the existing advisor, not merely an
insertion of a new lowest layer.

**Resolution.** Make the change, and make it its own commit with its own test,
separate from anything Jev. It is defensible on its own terms (a caller stating
`slot.x` knows better than an inference from its own event list), but it must
not arrive inside an observation change where a regression would be read as
observation's fault. `W6.1`.

---

## 2. Four amendments proposed to the spec

A1 and A2 come from reading the spec against the code. A3 and A4 come from the
fourth-quadrant measurements (*The Fourth Quadrant*, Cognitive Fab, 19 September
2026: 42 cases plus 24 controls against `jev-latest`), which were not available
when the spec was written and which turn one of its requirements from a
reviewer's judgement into a mechanical check.

**A1 — move the predicate schema into `polyx-lens`.** JT1 places
`predicates.ts` under `polyx/src/ports/jev/`. But JT1's own justification for
putting the *interface* in the lens — "the free half has to be able to read an
annotation file to produce its compliance report" — applies with equal force to
the predicate set: an annotation line is uninterpretable without the predicate's
id, fact name and bands. Proposed split:

| lives in | holds | why |
|---|---|---|
| `polyx-lens/src/ports/observation.ts` | `Observer`, `Observation`, `Predicate`, `nullObserver`, band arithmetic (JT4), predicate YAML parse + validate, annotation read/write | pure, offline, testable without a key; the lens can read and re-derive |
| `polyx/src/ports/jev/` | `client.ts` (HTTP), `observer.ts` (the `Observer` impl), `calibrate.ts`, `annotate.ts` (the pass) | the vendor, the network, the key |

The licence line then reads "the network and the vendor are in the paid half",
which is a sharper and more checkable claim than "the predicate loader is".
Band arithmetic in the lens also means JT4.2's rejection rule is unit-tested
with no key present, which is where a test of a safety rule belongs.

**A2 — the wire format is known; pin it in the spec.** The harness at
`jev-lab/jev.py` establishes it and the spec should carry it, because JT2's YAML
has to map onto it:

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <key>
{ "state": "<text>", "model": "jev-latest",
  "questions": { "<name>": { "type": "noul", "instructions": "...",
                             "criteria": { "true": "...", "false": "..." } } } }
-> { "answers": { "<name>": { "noul": 0.93 } }, "usage": {...} }
```

`questions` is keyed by name and `answers` comes back under the same keys, which
is what makes JT5.1's batch a single map and means the predicate `id` is the
wire key. Retry on 429/529 with exponential backoff, per the harness.

**A3 — a predicate declares its quadrant, and quadrant four is rejected at
load.** JF2.4 already prohibits a predicate "over a question whose negation is
an absence", and gives the right pair of examples: *"Does this text state that
income was verified?"* is admissible; *"Was income verified?"* is not. The
measurements make that prohibition urgent rather than tidy, and show that no
amount of care in the wording substitutes for it:

| | |
|---|---|
| "Was income verified?" over 12 matched cases | **50% correct, 6 false assertions.** Jev answered *not verified* 12 out of 12 |
| "Does the text state income was verified?" over the same 12 | **12/12 correct**, p = 0.02 |
| Control A — hand Jev the complete event log | accuracy unchanged at 50%; mean confidence **rose** 0.62 → 0.72 |
| Control B — tell the model outright the record may be incomplete | separation between hidden-true and hidden-false: **0.037**, against a quantum of 0.01 |

The model is not failing. It is executing the closed-world assumption perfectly,
and **nothing in its response says which quadrant the question was in**. That is
precisely the failure polyx exists to prevent, arriving through the port polyx
is adding, so the check belongs at the port.

Therefore: `quadrant` becomes a required field on every predicate, one of
`text-unknown` (Q2 — the only fully admissible class), `text-closed` (Q1 — the
text decides and absence genuinely means no), `sequence-closed` (Q3), or
`sequence-unknown` (Q4). A predicate declaring Q4 fails validation at load with
JF2.4 quoted in the error. A predicate declaring Q3 is a warning, not an error,
and the message says what the page says: *the log is complete by construction
here; write the if-statement.* `W2.1`.

**A4 — calibration rejects a predicate whose labels do not separate.** This is
the mechanical form of A3, and it is nearly free because it reuses calibration
data that JF3.3 already collects.

Control B is the load-bearing result. A Q4 predicate does not announce itself in
its wording, in its confidence, or in a reviewer's reading — but it does
announce itself in a labelled sample, as a distribution that barely moves
between the two labels. 0.037 of separation is about three quantisation steps;
the honest reading is that the information was never in the text and the number
is noise around a prior.

So: calibration computes the separation between the observed `p` distributions
on label-true and label-false, and **refuses to write a calibration record when
it falls below `minLabelSeparation`**. Set the default at 0.20, matching JT4.3's
minimum band width, which the income predicate misses by a factor of five. The
error names the measurement and points at JF2.4, because a predicate that fails
this test is nearly always a quadrant-four question that got past review.

This is a stronger and earlier check than JT4.2, which rejects a *band boundary*
drawn through a cluster. A4 rejects the *predicate*, before any band is drawn,
and it is the one check that would have caught the example the spec itself uses.
`W3.2`.

**A4.1 — a corollary about window width.** Control A says a wider window made
the model more confident and no more correct. JT2.3 already warns that an
`episode.text` predicate is expensive to recalibrate; the measurement adds that
it is also risky in a specific direction. Record it on the review page beside
the existing warning: more context raises confidence without raising accuracy
when the missing fact is missing from the wider window too.

---

## 2.5 Validation against TypeSafe's own introduction

Checked against *Introducing System One Models & Jev* (Diogo Almeida, TypeSafe).
**Nothing in it invalidates the design.** Four of our decisions are upgraded
from an empirical observation to a structural reason, two numbers move, and one
item we had not thought to look at turns out to be open.

### Confirmed, and now for a better reason than we had

**The batch is architectural, not lucky.** We batch because we measured latency
flat in the number of questions (JT5.1). The introduction says why: sampling is
*parallel* — "generates all outputs in a single query" — against an
autoregressive LLM's one-token-at-a-time. Flatness is the design, not a
property that might regress in the next release. A per-predicate call is
therefore not merely wasteful; it is asking the model to work against its own
architecture. Output tokens are free besides, so there is no configuration in
which splitting a battery is right.

**Bit-instability is stated vendor behaviour, which makes the annotation pass
mandatory rather than prudent.** This is the most load-bearing check in this
section. Our whole architecture — call outside the mining path, output frozen,
digested and pinned (JF6.1–JF6.4) — rests on a Jev call not being a pure
function of its input. The introduction states the property in its own words:
"More consistent: returns **similar** answers for similar inputs." Similar, not
identical, and parallel sampling is why. Had it said *identical*, our annotation
store would be an elaborate cache. It does not, so the store is the only way
mining stays byte-for-byte reproducible.

**Type-safety means the client stays thin — and means less than it sounds like
here.** "The model never makes type errors… mathematically impossible" and
"can't hallucinate" remove a whole class of adapter code: no parsing, no
schema validation, no repair path, no malformed-response fallback. W4.3's
retries are network-only (429/529) and that is the correct scope.

But the claim is about *shape*, not *truth*, and the distinction is exactly our
subject. The twelve fourth-quadrant answers were perfectly type-safe, perfectly
well-formed, carried honest-looking probabilities — and were wrong six times.
A guarantee that the answer will parse is not a guarantee that the question was
answerable. Nobody on this project should read "can't hallucinate" as "can't be
wrong", and the phrase should not be repeated in our material without that
qualification.

**The `choice` prohibition (JT2.1) was right, and we had the wrong reason.** We
banned `choice` because we observed it return one label at 0.98–1.00 while
silently dropping co-occurring intents. The introduction shows that is not a
defect: `choice` is a categorical distribution over *mutually exclusive*
options, cardinality up to 255, with an explicit two-stage score-then-choose
path for the high-cardinality case. It was answering a mutually-exclusive
question correctly. The fault was ours for asking it of a multi-intent input.
Restate JT2.1 structurally: a `noul` battery is the right shape because
co-occurring observations are not alternatives, and one assert-only `noul` per
alternative costs nothing.

Alignment worth noting in passing: "possible outputs and structure are defined
in advance" is JF1.1 — a predicate is a declared, reviewed, versioned artefact
and is never constructed at runtime.

### Two numbers that move

**Cost is not a risk. It is a rounding error.** At $0.042/MTok input with output
free, annotating the whole `cc` corpus — roughly 112,000 typed events, at the
measured ~500 input tokens for a battery — costs on the order of **$2**, before
the text cache (JT5.2) collapses repeated texts at all. Section 10's "cost at
corpus scale: low" understates it by enough to change a decision.

Two consequences, and the second is the important one:

- JT5.2's text cache is no longer justified by money. Keep it, for latency, for
  a smaller annotation file, and for a digest that does not move when a
  templated message repeats — but stop citing cost for it.
- **The binding constraint on a predicate is human labelling, not API spend.**
  JF3.2 asks for 60 labelled items with at least 15 per label; that is the
  entire cost of a predicate, and it is a person's afternoon. This reframes the
  roadmap: declare predicates generously, calibrate them selectively, and let
  `audit`'s declared-but-inert count carry the backlog. It also says where
  step 8 will actually bottleneck, which is not where we assumed.

### A tension, correctly resolved already

The introduction's central claim is calibration: RLCD, "epistemically honest
probabilities", "higher confidence means higher accuracy". Our Control A
measured the opposite locally — handing the model a more complete record moved
mean confidence 0.62 → 0.72 while accuracy stayed at 50%.

These do not contradict each other, and it is worth being precise about why.
Calibration is a property over a task distribution. A quadrant-four question
sits outside the distribution the guarantee is about: the model is calibrated
with respect to *the text it was given*, and we asked it about *the world the
text describes*. It reported, honestly and with good calibration, how clearly
the text reads — which is not the quantity we wanted.

Spec section 9 already declined to rely on the global claim, deriving bands per
predicate from a labelled sample on the corpus in use. The introduction
validates that stance rather than undermining it, and A4 is simply the local
calibration check made mandatory. No change.

Separately: TypeSafe positions Jev to "verify, guardrail, and detect
jailbreaks". Our spec section 9 says this is not a security control, because a
predicate reading a poisoned text will faithfully report what the poison says.
That remains our position about *our* use of it; it is not a claim about theirs,
and the positioning should not drift into our material.

### One open item this raised

See **W0.3**. "All answers are accompanied with calibrated probabilities **and
confidence scores**" describes two quantities. Every probe we have run reads
`.answers.<key>.noul` and nothing else, and no run has ever printed a whole
answer object. What we have been calling confidence is a quantity we derived
from `p` ourselves.

---

## 3. The work, in order

Sizes are relative: **S** a sitting, **M** a day, **L** more than one.

### Step 0 — decisions before code

- **W0.1** Settle A1–A4, and G1's text-port design. *(S, and it is the only
  blocking item in this plan.)*
- **W0.3** **Print one whole answer object.** *Answered, 21 September 2026,
  by `scripts/jev-probe.mjs`.* An answer carries nothing beyond its
  probability — `type` echoes the question — so what we had called
  confidence is `p`, and A4 is the only quadrant-four detector. **But the
  response carries `"model": "jev-1.13.0"`** when `jev-latest` was asked
  for: the dated model id that section 10's risk 1 said did not exist. Every
  probe before this one had discarded it. It is now on every annotation
  line, `annotate` reports which model answered and says to pin it, and
  `--diff` tells a model change from jitter. Risk 1's mitigation is in place.
  The original note follows for the record. *(Minutes, and it should happen
  before W4.4 freezes the annotation schema.)* The introduction advertises
  probabilities *and* confidence scores as two things; every probe we have run
  reads `.answers.<key>.noul` and discards whatever else is there. Two
  possibilities, and both matter:
  - There is nothing else, and what we call confidence is `p`. Then the record
    stands as written and A4 is the only Q4 detector available.
  - A `noul` answer carries a second-order uncertainty of its own. Then it is a
    **per-call** signal where A4 is a per-calibration one — plausibly an earlier
    and cheaper detector for the quadrant-four case, and one that works on a
    site we never labelled.

  Either way, **the annotation store must retain the whole answer object from
  the first pass**, not just `p`. That is JT3.3's own argument — `p` is retained
  so that a band change does not require a fresh pass over the corpus — applied
  to a field we have not examined yet. Discarding it costs a re-annotation of
  every corpus later. Amend W4.4 accordingly.
- **W0.2** The three asks, as put to TypeSafe on the fourth-quadrant page:
  dated model ids (risk 1 in section 10 has no mitigation without them),
  VPC/on-prem (JT7.5 — and for a bank corpus it is the first question, not the fifth),
  and a review of the port design itself. None blocks steps 1–3.

### Step 1 — the port, and nothing behaves differently *(M)*

Spec section 11.1. Lands the interface and the safety machinery with no vendor
and no network anywhere.

- **W1.1** `polyx-lens/src/ports/observation.ts`: `Observation`, `Predicate`,
  `Observer`, `nullObserver`. Export from `src/index.ts` beside the other three
  ports, with the same "a port with one implementation is a wish" comment.
- **W1.2** Band arithmetic (JT4.1, JT4.3, JT4.4): `emit(p, bands)` returning
  `true | false | null`, quantum validation, the `assertAt - refuteAt >= 0.20`
  rule, and the explicit prohibition on averaging repeated calls. Pure; unit
  tests only.
- **W1.3** The text-resolution port (**G1**): `TextSource` in the lens with a
  `nullTextSource` returning nothing, and resolvers for `cc`, `abcd` and
  `synthetic` in the adapters that already know their raw shapes. `episode.text`
  composes from `event.text` in `seq` order.
- **W1.4** Boundary rules in `scripts/check-boundary.mjs`. The existing script
  enforces one thing (the answer key) with an `ALLOWED` top-level list; add a
  second, independent rule set rather than widening the first:
  - JT1.1 — no `src/ports/jev/` symbol, no `typesafe`, no `POLYX_JEV_KEY`
    outside `src/ports/jev/` (`cli` excepted for command dispatch only).
  - JT1.2 — no `Observer` import under `src/mine/`, `src/evaluate/`, `src/diff/`.
- **W1.5** And the one the spec asserts but nothing checks: a network-egress
  check in `polyx-lens` forbidding `node:http`, `node:https`, `node:net`,
  `fetch`, `undici` anywhere in that package. The claim "the Apache-2.0 half
  makes no network call under any configuration" is currently a promise; this
  is the two lines that make it checkable, which is the standard the rest of
  the repo holds itself to.
- **W1.6** Null-equivalence test (JT9.3): `coverage synthetic` with observation
  disabled is byte-identical to today's output (JF5.3).

*Exit:* `npm run ci` green, nothing in the output of any command has changed.

### Step 2 — predicate sets *(S–M)*

Spec section 11.2.

- **W2.1** `alphabets/predicates.<corpus>.yaml` parse + validate per JT2, in the
  lens per A1. Enforce at load: `type` is never a field (JT2.1), `score`
  rejected (JT2.2), `status: real` without a `calibration` block is a load
  failure (JT2.4), `source` resolves against an adapter with a text resolver,
  and per **A3** `quadrant` is required — `sequence-unknown` is rejected with
  JF2.4 quoted, `sequence-closed` warns and says to write the if-statement.
- **W2.2** `polyx predicates <corpus>` and `--show <id>` (JT9). Follows the
  shape of `polyx alphabet show`.
- **W2.3** `predicateSetVersion` plumbed into `Manifest` (lens `manifest.ts`)
  alongside `alphabetVersion`, plus `annotationDigest`, computed exactly as
  `corpusRevision` is (JT3.5) so the two read alike.

*Exit:* a predicate set for `cc` exists, validates, lists as declared-and-inert.

### Step 3 — calibration *(M–L)*

Spec section 11.3. The labelling surface is the bulk of this and it already has
a precedent in the repo.

- **W3.1** `polyx calibrate <corpus> <id>`: draw a sample, present it for
  labelling, derive bands from the observed distribution, write the calibration
  record. **Reuse `src/evaluate/gold-server.ts`** — one pair per screen, verdicts
  saved as given — rather than inventing a second labelling surface. It is the
  same interaction with a different payload.
- **W3.2** Band derivation, never defaulted (JF3.3), with two rejections:
  JT4.2's (a boundary within 0.02 of a mode fails) and **A4**'s (label
  separation below `minLabelSeparation`, default 0.20, refuses the calibration
  record outright and names JF2.4). A4 runs first — there is no point drawing a
  band on a predicate that is not reading the text. Unit-tested against the
  published fourth-quadrant distributions: the income predicate's 0.037 must
  fail, and the *does-the-text-state* form of the same question must pass. No
  key needed for either, which is what A1 buys.
- **W3.3** Staleness (JF3.5): a calibration is inert when `predicateSetVersion`,
  `alphabetVersion` or `corpusRevision` has moved. Inert predicates emit nothing
  in every path.
- **W3.4** `minCalibration` (60, at least 15 per label), `minPredicatePrecision`
  (0.90) and `minLabelSeparation` (0.20, per A4) into `Thresholds`, so they
  sweep and appear in every manifest like every other threshold.

*Exit:* one `cc` predicate calibrated end to end, its record committed.

### Step 4 — annotation *(L)*

Spec section 11.4. **Dry-run first, egress second.** This order is not a nicety:
JT7.3 says the preview is the artefact a compliance reviewer reads *before a key
exists*, and steps 1–4 are worth doing even if the JF8 experiment later fails.

- **W4.1** Text redaction profile (**G3**) in `polyx-lens`: pattern rules over a
  text span, sharing `token`/`hash` surrogates with slot redaction, declared per
  corpus, with a profile id. JT7.2 fails closed on a corpus without one, naming
  the corpus.
- **W4.2** `polyx annotate <corpus> --dry-run` writing
  `.polyx/annotations/<corpus>.preview.jsonl`, the exact redacted payloads, no
  network code reached. Ship this and review it before W4.3 is merged.
- **W4.3** `src/ports/jev/client.ts` per A2: POST, bearer key, 429/529 backoff,
  `jevConcurrency` (4), `jevBudget` with partial-file semantics (JT8.5).
- **W4.4** The pass (JF6.1): group by resolved text across the whole corpus,
  key by `sha256(text)` so repeated texts collapse to one call (JT5.2), batch
  every predicate sharing a text into one call (JT5.1). Write JSONL sorted by
  `(interactionId, episodeId, seq, predicate)`; `p` **and the rest of the answer
  object** retained on every line including withheld (JT3.3, and W0.3 —
  retaining a field we do not yet use costs bytes, while discarding it costs a
  re-annotation of every corpus); `value: null` written, never omitted (JT3.2);
  temp-write, digest, rename (JT3.4).
- **W4.5** `--diff` against the previous annotation file: emitted facts changed,
  which is the drift measurement (JF6.6) and the only detector for section 10's
  risk 1 until dated model ids exist.
- **W4.6** Tests: redaction refusal (JT7.2), digest stability given a fixed
  file, dry-run makes no call (assert by injecting a throwing client).

*Exit:* `cc` annotated, digest in the manifest, `--diff` near zero on a
re-annotation.

### Step 5 — mining over observed facts *(M)*

Spec section 11.5. This is where **G2** has to be fixed or the step yields
nothing.

- **W5.1** Annotation reader in the lens; miner loads it as corpus data and
  keys by `(interactionId, episodeId, seq)`, all three of which `Instance`
  already carries.
- **W5.2** **G2**: candidacy counts a recorded withholding as the second value
  for `obs.*` facts, while the emitted fact base still omits it. Test: a planted
  assert-only predicate produces a conditioned rule; the same predicate with its
  annotation file removed produces none.
- **W5.3** `instanceFacts` gains observations. Note the `WeakMap` memo in
  `lens/facts.ts:21` is keyed on `Instance` alone — either key it on the
  observation set too or thread observations through explicitly. Silently
  serving a memoised pre-observation fact base is a bug that will not announce
  itself.
- **W5.4** `check:boundary` proves JF6.3: the miner reads the store, never the
  port. Already covered by W1.4's JT1.2 rule; add the negative test (JT9.3).

*Exit:* a conditioned rule over `obs.*` mined on `cc`, reproducible from the
committed annotation file with the network off.

### Step 6 — the advisor seam and the invariant *(M)*

Spec section 11.6. The smallest diff in the plan and the one that carries the
argument.

- **W6.1** **G5** first, alone: fix `factsAt`'s precedence to caller >
  `slot.*` > `episode.intent`, with a test per pair (JT9.3). Separate commit.
- **W6.2** Then add the observation layer at the bottom, with the comment JT6.1
  requires — the merge order *is* JF5.2, and JF7.5 says the invariant depends on
  it.
- **W6.3** The property test (JT9.3, JF7.4): over the synthetic corpus, for a
  random subset of observations, assert JF7.1 (no warning withdrawn), JF7.2
  (`missing` non-increasing) and JF7.3 (verdict non-decreasing under
  `abstain < clear < recommend < warn`) at every decision point. This is the
  bank-facing claim; it is the one test worth over-engineering.
- **W6.4** `test/fixtures/synthetic` gains JT9.4's planted observable rule —
  satisfiable only through an `obs.*` fact — with its annotation file committed.
  Runs offline, and is the oracle for steps 4–6 together.
- **W6.5** `coverage` (JT9.2) splits `answered` into with- and
  without-observation and reports the two yield numbers: abstentions resolved,
  warnings newly raised. `audit` (JT9.1) gains declared / inert / unobservable,
  and errors on a `real` rule naming an `obs.*` fact no `real` predicate
  produces. JF4.3 is the same check at adjudication time.

*Exit:* the property test passes; `coverage cc` reports a split.

### Step 7 — the live path *(M)*

Spec section 11.7.

- **W7.1** **G4**: optional `text` per event on `AdviseRequest`, validated in
  `parseRequest`, redacted at the HTTP boundary under the corpus text profile.
- **W7.2** Resolve observations in `src/serve/http.ts` before calling
  `advise`, keeping `Advisor.advise` synchronous and pure (JT6.2).
- **W7.3** Store migration v7: observations on the decision log with `p`,
  predicate id and predicate-set version (JT8.3). `MIGRATIONS` is append-only
  and `SCHEMA_VERSION = MIGRATIONS.length`; add, never edit. A live period then
  replays later without a key, which is the same recorded-answer pattern as
  JF6.1.
- **W7.4** Fallback (JT8.4): no key, unreachable, or budget exhausted falls back
  to the null observer, logged as `observer: null` so degraded coverage is
  visible rather than read as corpus drift.
- **W7.5** Replay determinism (JT8.1): `coverage` and `evaluate` MUST NOT call
  the port. Test = run `evaluate` twice against one annotation file with the
  network disabled on the second run.

### Step 8 — the experiment *(M)* — **this is the gate**

Spec section 8 and section 11.8. Everything above is machinery; this is the only
part that decides whether the integration ships.

- **W8.1** **Classify each of the five by quadrant before writing anything.**
  The fourth-quadrant analysis predicts the result of the experiment more
  cheaply than the experiment does: an instruction that depends on *what a file
  contains* or on *an argument's value* is a Q2 question and a predicate can
  observe it; one that depends on world-state the transcript never mentions is
  Q4 and no predicate will ever reach 0.90, however it is worded. Classifying
  first costs an afternoon and tells us which of the five are worth calibrating
  at all.
- **W8.1b** Then one predicate per surviving instruction from
  `runtime-gap-brief.md` section 5. Calibrate each. Count how many reach assert
  precision at or above 0.90 — and record the A4 separation alongside, because a
  predicate that passes precision on a small sample but separates by 0.04 is the
  income predicate wearing a better score.
- **W8.2** Report the ones that stay unobservable **by name with the reason**
  (JF8.1). This is the whole argument of the runtime-gap brief and it applies to
  this integration before it applies to anything else.
- **W8.3** Then `abcd`: JF8.2 says start from `coverage`'s existing
  `missingFacts` ranking rather than guessing which predicates to write. That
  list is already produced (`coverage.ts`, top 10 by count) — the predicates
  worth writing first are already named by the tooling.
- **W8.4** Neither figure leaves the machine without its manifest, including
  `annotationDigest` and `predicateSetVersion` (JF8.3).

**Decision:** 4–5 of 5 becomes checkable, proceed to a customer corpus. 2–3,
worth having, and the boundary between the two groups is itself a finding worth
writing up. 0–1, the gap is not a text-observation gap; stop, and say so.

### Results so far

| predicate | sample | separation | outcome |
|---|---|---|---|
| `states_a_reason` | 60 (19 yes, 40 no, 1 unsure), `jev-1.13.0`, 21 Sep 2026 | **0.281** — passes A4 | **refused on precision**: 0.50 at every threshold. Both labels bimodal: 13 of 40 *no* above 0.7, 5 of 19 *yes* below 0.2. Not noise — a systematic disagreement between reviewer and model over what "a reason" is, on a question that named four things at once. Left proposed; split into `states_a_symptom` and `states_a_because`, each asking one thing. Set bumped to v2. |

| `states_a_symptom` | 60 labelled (10 yes, 45 no, 5 unsure), not measured | — | **stopped at the per-label floor**: 10 yes is below 15. Base rate one in six. Left proposed with its 60 labels kept; a larger draw extends the sample without losing them. |

The first refusal is the gate working. A4 passed — the text answers the
question, so this was not a quadrant-four case — and the precision gate
declined to hand the miner a fact that would have been right half the time.
The distribution said which of the two gates it was and why, and the fix was a
rewording rather than a re-think.

The second is a constraint the spec did not anticipate. **A predicate's
labelling cost is not sixty items; it is `15 / base-rate`.** A predicate true
one time in six needs ninety random items to clear the per-label floor; one
true in twenty needs three hundred. Sixty is the cost of a predicate whose
answer is *yes* a quarter of the time, and most interesting predicates are
rarer than that. Two consequences for W8:

- Before labelling, estimate the base rate from the first twenty items. If it
  is below a quarter, either draw larger from the start or **stratify** —
  draw part of the sample from texts a cheap keyword filter marks as likely
  positives, label every item as before, and state the stratification in
  the record. The gold surface already samples this way, for the same reason
  (a random draw is dominated by the easy case). `sample --stratify <regex>`
  is the next thing to build.
- The reviewer's hour is the budget, and it is spent on *no*s. The plan's
  cost figure — "sixty labels is a person's afternoon" — was right about the
  unit and wrong about the multiplier.

---

## 4. Test ledger

JT9.3 lists seven required tests and JT9.4 one fixture. Mapped to steps:

| test | step |
|---|---|
| `factsAt` precedence, one per pair | W6.1 |
| Property test: JF7.1–JF7.3 over synthetic, randomised observations | W6.3 |
| Null-observer equivalence: `coverage synthetic` byte-identical | W1.6 |
| Band rejection within 0.02 of a mode | W3.2 |
| *(added)* A4: labels separating by less than 0.20 refuse a calibration record, against the published 0.037 | W3.2 |
| *(added)* A3: a `sequence-unknown` predicate fails validation at load | W2.1 |
| Boundary: a Jev import outside `src/ports/jev/` fails CI | W1.4 |
| Annotation replay: `evaluate` twice, network off the second time | W7.5 |
| Redaction: a corpus with no profile refuses to annotate | W4.6 |
| Fixture: planted observable rule plus committed annotation file | W6.4 |
| *(added)* miner proposes a rule over an assert-only `obs.*` fact — **G2** | W5.2 |
| *(added)* `polyx-lens` contains no network call | W1.5 |

---

## 5. What is worth doing regardless of the gate

Steps 1–4 stand on their own. A dry-run annotation preview over a customer
corpus (W4.2) is a compliance artefact whether or not a predicate is ever
adjudicated `real`, and W1.5 — a checked claim that the Apache-2.0 half makes no
network call — is worth having whether or not Jev is ever wired up. Steps 5–7
are only worth building if step 8 clears, so the cheapest honest ordering is to
run a *provisional* W8.1 on two or three predicates as soon as step 4 works,
before paying for steps 5–7 in full.

---

## 6. Revision log

**Rev. 1, 19 September 2026.** Written against `polyx-jev-integration-spec.md`
rev. 1 and polyx at `d7ced9d`. Section 1 is the part of the spec that did not
survive contact with the code; A1 and A2 follow from it.

**Rev. 3, same day.** Section 2.5 added: the design validated against
TypeSafe's own introduction of the model. Nothing invalidated; four decisions
re-justified structurally rather than empirically, cost demoted from a risk to a
rounding error with the constraint relocated to human labelling, and W0.3 opened
because the vendor describes two quantities per answer where we have only ever
read one.

**Rev. 2, same day.** A3 and A4 added after the fourth-quadrant measurements
(42 cases plus 24 controls). They do not change the architecture — the spec
already prohibited the question that fails, in JF2.4 — but they move that
prohibition from a reviewer's judgement to two checks the tool performs, one at
load and one at calibration. The controls are what justify the second: a Q4
predicate is invisible in its wording and in its confidence, and visible only in
a labelled sample.
