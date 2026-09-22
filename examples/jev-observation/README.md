# Observing a fact the typed record cannot see

Ten minutes, no API key, no network. Every command below runs against a
fixture that ships with `polyx-lens`, and `test/walkthrough.test.ts` runs
them all in CI so this page cannot drift from the code.

## The problem in one paragraph

polyx mines rules from what an agent *did*, typed as events with declared
consequences, and serves them back with abstention: a fact absent from the
record is **unknown**, never false. That is the product, and it is also the
largest single loss in coverage. A rule cannot be conditioned on anything
nobody wrote down as a typed slot — and in a customer conversation, most of
what decides the next action was said, not typed.

A System One model (TypeSafe's Jev) evaluates a predicate over text and
returns a calibrated number in ~200ms. That is exactly the missing operation
and nothing more than it. This walkthrough shows it wired in as an
**observation port**: a function from (text, declared predicate) to a fact,
or to nothing. It never decides a verdict. Everything downstream of the fact
base is unchanged.

## The fixture

`synthetic-observable` is ten customer complaints. In every typed respect
they are identical up to the decision point: same intent, same slots, the
same identity check before it. Five of them say the customer was **charged
twice** — in the text — and the agent escalated. Five say something else and
the agent applied a credit. Nothing in the typed record separates the two
groups. A rule that recommends escalation for the first five and not the
second can only be conditioned on what was said.

## 1. What is declared

```
$ polyx predicates synthetic-observable

polyx predicates — synthetic-observable: predicate set v1, model stub, redaction text.synthetic@1

  real       states_double_charge         obs.states_double_charge         text-unknown     calibrated 2d

declared 1, emitting 1, inert 0
```

A predicate is a reviewed artefact in `alphabets/predicates.<corpus>.yaml`,
under the same discipline as the alphabet. This one asks *"does this message
state that the customer was charged twice for the same thing?"* Three fields
worth reading before you write your own:

- **`quadrant: text-unknown`** — the question is about what the text
  *states*, and silence means unknown. The prohibited quadrant is
  `sequence-unknown`: a question about what happened in the *world* over a
  record that may not mention it. Asked "was income verified?" over twelve
  matched loan cases where the record was equally silent in all twelve, the
  model answered *not verified* twelve times out of twelve and was right half
  the time. It was not failing; it was applying the closed-world assumption
  perfectly to a partial record. Asked whether the text *states* income was
  verified, it was right twelve times out of twelve. The loader refuses the
  first form at parse time and tells you to write the second.
- **`refuteAt: -1`** — assert-only. This predicate can contribute a `true`
  and can never contribute a `false`, because "the text does not say so" is
  not "it did not happen".
- **`calibration`** — bands are derived from a labelled sample, never set by
  hand. A predicate with no calibration record emits nothing, everywhere.

## 2. See what would leave the machine

```
$ polyx annotate synthetic-observable --dry-run

dry run — 13 distinct payload(s) over 30 site(s) written to
  .polyx/annotations/synthetic-observable.preview.jsonl
under text.synthetic@1. Nothing was sent. Read every line before configuring a key.
```

```
$ head -1 .polyx/annotations/synthetic-observable.preview.jsonl
{"sha":"7de6a4bfeda46f5c","predicates":["states_double_charge"],"redaction":"text.synthetic@1",
 "fired":{"literal→account":1},
 "before":"This is unacceptable. My account ACC-55667788 was charged twice for the same order.",
 "after":"This is unacceptable. My account account#beaede3949f5 was charged twice for the same order."}
```

Thirty sites, thirteen distinct texts: templated agent messages repeat, and
the pass calls once per distinct *redacted* text. `before` and `after` sit
side by side so a compliance reviewer can see what each rule caught. This is
the artefact to produce and read before a key exists, on any corpus that
holds customer text. The preview is the one file allowed to hold the
original; the annotation store never carries text at all.

A corpus with no declared text redaction profile cannot be annotated. The
command refuses by name.

## 3. Install the recorded answers

With a key, `polyx annotate synthetic-observable` would make thirteen calls
and write the answers to `.polyx/annotations/`. A Jev call is not bit-stable
— the vendor's own description is "similar answers for similar inputs" — so
the answers are recorded **once**, in this separate pass, and everything
downstream reads the recording. Mining never calls the model; the boundary
check fails the build if anything under `src/mine/` could.

Without a key, install the recording that ships with the fixture. It was
produced by a stub that reads the text for real:

```
$ polyx annotate synthetic-observable --import node_modules/@cognitive-fab/polyx-lens/fixtures/synthetic-observable/synthetic-observable@1.jsonl

imported 30 recorded observation(s) for synthetic-observable — predicate set v1, digest 39e93b226b4ac904
no call was made. mine, coverage and evaluate now read this file; the digest is in manifest annotate-…
```

Thirty lines: one per (site, predicate). Five say `"value":true`. The other
twenty-five say `"value":null` — a **recorded withholding**, with its `p`
kept. A missing line and a withheld line mean different things, and only the
second says the predicate was asked. The digest joins `corpusRevision` and
`alphabetVersion` in the run manifest: anyone holding this file reproduces
every figure below, byte for byte, with no key.

## 4. Mine

```
$ polyx mine synthetic-observable --threshold minInstances=3

2f663a4cec907cc9  [proposed] op-alpha  5/5  own@operator
  When obs.states_double_charge = true, escalate to a supervisor.
  never violated (5/5); this is what was done; good outcome 0 of 5 times it was followed
…
observations: predicate set v1, annotation 39e93b226b4ac904 — 5 fact(s) at 10 site(s)
```

There is the planted rule, conditioned on `obs.states_double_charge`, at
five out of five. Run the same command without the annotation file and no
rule recommends escalation at all — the typed record cannot separate the two
groups.

Two things in that line are worth a second look. *"This is what was done"*
is agreement, and *"good outcome 0 of 5"* is outcome precision, and they are
two different figures on purpose: a rule that faithfully reproduces what
agents do is a faithfully mined mistake unless the second figure says
otherwise. Here every escalation is labelled `escalated`, which is not a
good outcome, and the rule says so.

And `obs.` is a namespace. An observed fact is distinguishable from a slot
and from a caller-supplied fact everywhere it appears: in a rule's condition,
in an abstention's `missing` list, in the decision log.

## 5. Adjudicate

```
$ polyx review synthetic-observable mark 2f663a4cec907cc9 real --reviewer jjd
```

Nothing is served that a person has not marked `real` — and a rule that
depends on an `obs.*` fact cannot be marked real while the predicate that
produces it is not. Try it against a predicate set where the predicate is
`proposed` and the command refuses, naming the fact and telling you to
calibrate first. Served, such a rule would abstain at every request while
looking like a rule in service.

## 6. Replay

```
$ polyx coverage synthetic-observable

coverage             50.0%  (5 answered; 0 abstained as uncovered, 5 as unknown-fact)
verdicts             recommend 5, abstain 5
agreement            100.0%  (5/5 recommendations matched the action taken)
facts most often missing: obs.states_double_charge (5)

observation          annotation 39e93b226b4ac904: 5 decision point(s) carried an observed fact
  answered             0 without observation, 5 because of it
  yield                5 abstention(s) resolved, 0 warning(s) newly raised — nothing else can move (JF7)
```

Five answered because of observation. Five still abstaining, because their
text said something else and **silence is not denial**: the predicate was
asked, withheld, and the advisor sees *unknown*, exactly as it does for any
fact nobody supplied. The `missing` list names the fact, so a caller knows
what would resolve it.

Now the same replay with the annotation file removed:

```
$ mv .polyx/annotations/synthetic-observable@1.jsonl /tmp/
$ polyx coverage synthetic-observable

coverage             0.0%  (0 answered; 0 abstained as uncovered, 10 as unknown-fact)
observation          none — replayed over typed state only
```

Zero. The rule is real and served; its one condition is unknown at every
decision point; it abstains ten times out of ten. Put the file back and it
answers five.

## The invariant

The last line of the coverage report — *nothing else can move* — is the
part a bank will ask to see, and it is a consequence of one merge order
rather than a promise. Observed facts enter the fact base **first**, under
the slots, under the inferred intent, under whatever the caller supplied.
Observation only ever adds keys. A condition over a key that was already
there is unaffected by adding others, so a rule that was true stays true, a
rule that was false stays false, and only a rule that was **unknown** can
move. Therefore:

- **no warning is withdrawn** — every warning raised without observation is
  raised with it;
- **no abstention is created** — `missing` is monotonically non-increasing;
- **verdicts move one way** — `abstain < clear < recommend < warn`, never
  backwards.

`test/invariant.test.ts` asserts all three over every decision point of the
synthetic corpus, sixty random rule sets, and random observation sets that
withhold, assert and refute over every fact name a rule could mention —
including deliberate collisions with slot and caller facts. Eight thousand
checks. And the test was shown to fail: apply observations *last* instead of
first and it goes red.

The practical reading: switching a predicate on can surface a warning that
was hidden behind an unknown, and can turn an abstention into an answer. It
cannot make polyx go quiet where it used to speak, and it cannot make it
bless an action it used to warn about. A reviewer who distrusts a predicate
can adopt it without re-validating the rules that already worked.

## On your own corpus

The order matters, and the first two steps need no key.

1. **Declare.** Write `alphabets/predicates.<corpus>.yaml`. Every predicate
   asks what a text *states*; every one you are unsure about is assert-only.
   Classify each by quadrant before anything else — a `sequence-unknown`
   question will not calibrate however it is worded, and the loader will
   tell you.
2. **Preview.** `polyx annotate <corpus> --dry-run`, then read the file. If a
   customer identifier survives, fix `alphabets/text.<corpus>.yaml` and run
   it again. On the first real corpus this took three passes; the last one
   found nothing in 2,721 payloads.
3. **Label.** `polyx calibrate <corpus> <id> sample` draws ~60 distinct texts;
   `polyx calibrate <corpus> <id> serve` puts them on screen one at a time,
   three keys — yes, no, *can't tell from the text*. The labeller is never
   shown the model's answer. If many come back *can't tell*, the question is
   in the wrong quadrant.
4. **Derive.** With `POLYX_JEV_KEY` set, `polyx calibrate <corpus> <id>
   derive` asks the model about the labelled sample and derives the bands —
   or refuses, and says why. The refusal that matters: labels that separate
   by less than 0.20 mean the answer was never in the text. Paste the record
   into the predicate set, mark it `real`, bump the version.
5. **Serve.** `polyx serve <corpus>` picks up the same predicate set and
   profile. A request whose events carry `text` is redacted and observed
   before the advisor answers; every observation is logged with its `p`, and
   with no key the request is answered over typed state only and logged as
   `observer: null`. `examples/claude-code-hook/` sends the text.
6. **Annotate.** `polyx annotate <corpus>`. Once. Commit the file's digest
   with any figure you quote. Re-run later and `--diff` reports how many
   emitted facts moved, which is the drift measurement — and, until the
   vendor exposes dated model ids, the only detector for the model changing
   under `jev-latest`.

The cost of a predicate is the sixty labels, not the API bill: at the
vendor's published pricing, annotating a corpus of a hundred thousand events
is on the order of two dollars.

## What this does not do

- **No witness.** Jev returns no text, so an observed fact can never explain
  itself. A rule that fires on one shows the reviewer the question, the `p`
  and the source text; it cannot show a reason.
- **No sequence reasoning.** A predicate reads one text. Every ordering
  property — the thing polyx is actually about — is mined and served exactly
  as before.
- **Not a security control.** A predicate reading a poisoned text will
  faithfully report what the poison says.

## Files

| | |
|---|---|
| `polyx-lens/src/ports/observation.ts` | the port, the null observer, band arithmetic, the separation gate |
| `polyx-lens/src/ports/predicates.ts` | the predicate set loader and its refusals |
| `polyx-lens/src/alphabet/text.ts` | text redaction profiles |
| `polyx-lens/src/ports/annotations.ts` | the annotation store: sort, digest, partial, diff |
| `polyx/src/ports/jev/` | the vendor: client, observer, the annotation pass, calibration, the labelling page |
| `polyx/src/serve/advisor.ts` | `factsAt` — the one function the seam changed |
| `polyx/test/invariant.test.ts` | JF7 as a property |
| `polyx/test/observable.test.ts` | this walkthrough's oracle |
| `docs/polyx-jev-integration-spec.md` | the specification the `JF`/`JT` ids refer to |
