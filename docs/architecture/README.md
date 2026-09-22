# polyx — architecture

Mine the rules an agent's own history supports, put them in front of a person, and serve the ones they accept at the moment a consequential action is about to happen — abstaining rather than guessing when a fact is missing. A System One model may observe what was said, and may add a fact; it may never assert an absence.

Analysed at [`c80a068`](https://github.com/cognitive-fab/polyx/tree/c80a06871222274d79cdca0a645ee28567044f40).

**Read from.** src/mine/, src/store/, src/serve/, src/review/, src/evaluate/, src/diff/, scripts/check-*.mjs (code); polyx-bench: policies/, polyx-eval: policies/cc-policy.yaml (code); LICENSING.md, docs/polyx-technical-spec.md (document); polyx-lens: src/ports/observation.ts, src/ports/text.ts, src/ports/predicates.ts, src/ports/calibrate.ts, src/ports/annotations.ts, src/alphabet/text.ts, src/record.ts, src/alphabet/, src/ingest/, src/ports/, src/pipeline.ts, src/lens/ (code); src/ports/jev/, src/serve/observe.ts, src/serve/advisor.ts, scripts/check-boundary.mjs, scripts/check-notice.mjs, examples/ (code); docs/polyx-jev-integration-spec.md, docs/polyx-jev-implementation-plan.md (document).

> Generated from the analysis by archlens. Edit the analysis, never this file.

## What this architecture answers

### What can somebody run without buying anything?

**A stranger installs the free half and points it at their own logs. What actually happens, and what does it need?**

It reads the transcripts the agent already wrote, types every event through a reviewed alphabet, and counts how often each written rule was kept — with no store, no adjudication, no model call and no network. The report leads with what the alphabet could not name, because a figure measured over the share of actions a parser happened to understand is not a measurement.

[Open the diagram](free-half.architecture.html) — 8 components.

| Component | Responsibility |
|---|---|
| **Corpora** | Holds the recorded work wherever it already is, because a corpus that has to leave the machine is a corpus nobody will hand over. |
| **Ingest adapters** | Turns each source format into raw interactions with one pure function per format, each held to a field-level fixture test on hand-checked examples. |
| **Alphabet** | Declares what every event is and what it costs to take back, as a reviewed artefact that is versioned and stamped on every figure derived from it. |
| **Pipeline** | Turns raw interactions into validated records in one vocabulary, so everything downstream consumes one shape. |
| **Contract sets** | Carries the rules a harness states about itself, decomposed into clauses, with the ones no precedence language can reach recorded alongside the reason. |
| **Clause checker** | Counts, for every written clause, how often the corpus exercised it and how often it broke it — over the window the clause itself names. |
| **The report** | Says what could not be named before it says any finding, separates never-violated from never-exercised, and names the question it cannot answer at all. |
| **polyx-lens** | Runs the whole free half against the transcripts the agent already wrote, with no configuration and no network call. |

**Deliberately not shown.** The ports and their polyness implementation, which the pipeline uses; and the miner, which this path never touches.

### Where does the licence boundary run?

**Two licences, four repositories. Which components sit on which side, and what stops the line moving?**

The free half is the whole front of the system — record, alphabet, adapters, ports, pipeline and the report. The paid half is everything that turns a corpus into rules nobody wrote down. Exactly two edges cross, both from the free half into the paid one, and nothing crosses back: polyx depends on polyx-lens and polyx-lens imports nothing from polyx. That direction is checked by the build, which is what makes the split a fact rather than a claim. The vendored library underneath keeps its own Apache-2.0 licence. A third line was added for the vendor adapter: MIT, one directory, and the only code in either package that can make a network call.

[Open the diagram](licence-line.architecture.html) — 6 components.

| Component | Responsibility |
|---|---|
| **polyness** | Supplies the second implementation behind each of the three ports, vendored byte-for-byte so a checkout installs without a sibling repository. |
| **Ports** | Defines how a session is cut, what counts as a subject, and whose evidence a rule rests on — as interfaces rather than as one library. |
| **Pipeline** | Turns raw interactions into validated records in one vocabulary, so everything downstream consumes one shape. |
| **Miner** | Derives rules the corpus supports, each carrying its support, its provenance level and the records that contradict it. |
| **Store** | Keeps rules, human verdicts and run manifests under an identity stable across re-mining, so a verdict given last week still applies to the rule mined today. |
| **Jev adapter** | Makes the one network call in either package — one call per distinct redacted text carrying the whole predicate battery — and records which model actually answered. |

**Deliberately not shown.** The adapters, alphabet, contracts, checker and report sit inside the free half with the pipeline; the reviewer, advisor, evaluator and diff sit with the miner; the answer keys have a question of their own.

#### Terms used here

- **predicate** — A declared, reviewed yes/no question a model may be asked about a text, producing a fact named obs.<name>. Inert until calibrated.
- **System One model** — A model built for fast, calibrated structured decisions rather than text generation; Jev, from TypeSafe, is the one polyx integrates.

### How does a rule get from a corpus to a gate?

**What happens to one obligation between the recorded work and the moment it fires before a consequential action?**

The corpus is typed by a reviewed alphabet and cut into tasks by a segmenter. The miner proposes a rule with its support and the records that contradict it. A person marks it real, not_real or narrowed, and only what they marked real is ever served. At a decision point the advisor answers with three values, not two: it fires, it does not apply, or a fact is missing and it says so rather than assuming the fact is false.

[Open the diagram](corpus-to-gate.architecture.html) — 6 components.

| Component | Responsibility |
|---|---|
| **Corpora** | Holds the recorded work wherever it already is, because a corpus that has to leave the machine is a corpus nobody will hand over. |
| **Pipeline** | Turns raw interactions into validated records in one vocabulary, so everything downstream consumes one shape. |
| **Miner** | Derives rules the corpus supports, each carrying its support, its provenance level and the records that contradict it. |
| **Store** | Keeps rules, human verdicts and run manifests under an identity stable across re-mining, so a verdict given last week still applies to the rule mined today. |
| **Reviewer** | Puts one rule in front of a person with the records on both sides of it, and saves the verdict the moment it is given. |
| **Advisor** | Answers at a decision point using only rules a person marked real, and abstains when a fact is missing rather than treating absence as falsehood; an observed fact enters the fact base first, under everything else, so observation can only add. |

**Deliberately not shown.** The adapters, the alphabet and the ports that cut a session into tasks; and the evaluator, which measures rather than serves. The observation path, which has its own question below.

#### Terms used here

- **decision point** — An episode with a consequential action: the moment the advisor is asked, with what was known before the action.

### Which written rules may be shipped, and which never?

**The evaluation is scored against hand-decomposed rulebooks. Where do those live, and why are they not in the product?**

A clause set decomposes somebody else’s written rules so the miner can be scored against them. Two repositories hold them, split by whether the source rulebook is public: benchmark decompositions can be read by anyone checking a published figure, and anything derived from a private corpus is licensed to nobody. Neither is reachable from the mining side.

[Open the diagram](answer-keys.architecture.html) — 5 components.

| Component | Responsibility |
|---|---|
| **polyx-bench** | Holds hand decompositions of public benchmark rulebooks, so a published figure can be argued with clause by clause. |
| **polyx-eval** | Holds the clause sets decomposed from corpora that cannot be redistributed, and is licensed to nobody. |
| **Evaluator** | Scores the mined set against a written clause set, reporting recall over the clauses the corpus actually violated beside the headline figure. |
| **Miner** | Derives rules the corpus supports, each carrying its support, its provenance level and the records that contradict it. |
| **Contract sets** | Carries the rules a harness states about itself, decomposed into clauses, with the ones no precedence language can reach recorded alongside the reason. |

**Deliberately not shown.** The three-region diff and the serving path — the advisor never sees a clause set.

### Where can a model be called, and where can it not?

**polyx now integrates a model that reads text. Where exactly can that model be consulted, where can it not, and what keeps it there?**

Every mining figure polyx quotes reproduces byte for byte from a corpus, an alphabet and a threshold set. A model call is not bit-stable — the vendor's own description is 'similar answers for similar inputs' — so one call anywhere in the mining path would end that guarantee outright. At the same time, the largest loss in coverage is that a rule cannot be conditioned on anything nobody typed, and in a conversation most of what decides the next action was said. The integration has to give the miner what was said without ever letting it ask.

In one place, for mining: the annotation pass asks it once per distinct redacted text and writes the answers to a digested file, and the miner reads that file as data — check:boundary fails the build if anything under src/mine could import the port. The free half defines the port, holds the predicates, the redaction profile and the store, and can reach nothing: check:offline fails its build on any code that could. The vendor sits in one MIT directory, and the response names the model that answered, so a later drift is a model change and not a mystery.

[Open the diagram](model-boundary.architecture.html) — 7 components.

| Component | Responsibility |
|---|---|
| **Predicate sets** | Declares each question a model may be asked, under the same discipline as the alphabet, and refuses at load the one kind of question the measurements showed a model answers confidently and wrongly. |
| **Text redaction** | Strips identifiers from free text under a declared, versioned profile before a predicate, a labeller or a vendor sees it, and names the profile on every annotation line so a weaker one is identifiable after the fact. |
| **Annotation pass** | Resolves every site a real, calibrated predicate could read, redacts it, groups by distinct text, asks once per text, and writes the store — or, on a dry run, writes the exact payloads and sends nothing. |
| **Jev adapter** | Makes the one network call in either package — one call per distinct redacted text carrying the whole predicate battery — and records which model actually answered. |
| **TypeSafe API** | Answers a battery of yes/no questions over one text with calibrated probabilities in ~200 ms, and names the model version that answered. |
| **Annotation store** | Holds the model's answers, recorded once in a separate pass, sorted and digested, so that mining reads a pinned file rather than making a call that is not bit-stable. |
| **Miner** | Derives rules the corpus supports, each carrying its support, its provenance level and the records that contradict it. |

**Deliberately not shown.** The live path — the second place the model is called — which has its own question next; calibration, which is how a predicate earns the right to be asked; and the advisor.

#### The long read

Start at the predicate set on the left. A predicate is a declared yes/no question — 'does this message state the customer was charged twice?' — reviewed and versioned like the alphabet, and it declares its quadrant. The one kind of question the loader refuses is a question about what happened in the world over a record that may not mention it, because measured on twelve such cases the model answered from the record's silence every time and was right half the time. Everything below rests on asking only what a text states.

The annotation pass is the first of the two places the model is consulted. It resolves every site a real, calibrated predicate could read, redacts the text under the corpus's profile — the preview of exactly what would leave the machine is written before a key exists — groups by distinct text so templated messages collapse to one call, asks once per text with the whole battery, and writes one line per site and predicate to the annotation store. A withheld answer is a written line, not a missing one. The file is sorted, digested, and the digest is pinned in the run manifest beside the corpus revision.

The miner reads that file and never the port. That is not a convention: check:boundary fails the build if anything under src/mine imports the Observer. An observed fact is lifted into an instance's fact base from the sites before it, as a slot value is, and a withheld observation counts as evidence that the predicate was asked — which is what lets an assert-only fact, which never takes a second value, be a candidate condition at all.

The vendor sits in one directory under MIT. Nothing outside it may import a Jev symbol, name the package, or read the key; the free half, which defines the port, can make no network call under any configuration. A second System One implementation, or a local classifier, drops in behind the same interface and nothing above it changes.

#### Terms used here

- **predicate** — A declared, reviewed yes/no question a model may be asked about a text, producing a fact named obs.<name>. Inert until calibrated.
- **withheld** — The model's probability fell between the bands, so no fact is emitted. Recorded as a line with value null; the advisor sees unknown, never false.
- **bands** — Two thresholds per predicate: at or above assertAt emit true; at or below refuteAt emit false; between, withhold. Derived from a labelled sample, never set by hand.
- **assert-only** — A predicate whose refuteAt is unreachable, so it can contribute a true and never a false. The required setting wherever 'the text does not say so' must not become 'it did not happen'.
- **quadrant** — Which of four kinds of question a predicate asks: does the text decide or the sequence, and does silence mean no or unknown. Only 'text, unknown' is fully admissible; 'sequence, unknown' is refused at load.
- **annotation** — One recorded model answer for one (site, predicate): its probability, the fact emitted or null, the predicate-set version, the redaction profile, the text hash, and the model that answered.
- **calibration** — Labelling a sample of the corpus by hand, then measuring the model against the labels to derive bands. The labeller never sees the model's answer.
- **System One model** — A model built for fast, calibrated structured decisions rather than text generation; Jev, from TypeSafe, is the one polyx integrates.

### What can an observation do to a verdict?

**A request from an agent may now carry what was said. When the model reads it, what can change in the answer — and what is guaranteed not to?**

The live path is the second of the two places the model is consulted, and the one a bank will ask about: a fact the model produced is about to influence whether an action is warned against. The guarantee has to be about the shape of the change, not the accuracy of the model, because the model's accuracy is exactly what a reviewer has not yet verified.

An observation can surface a warning that was hidden behind an unknown fact, and can turn an abstention into an answer. It cannot withdraw a warning, cannot create an abstention, and cannot move a verdict backwards. This is a consequence of one merge order rather than a promise: observed facts enter the fact base first, under the slots, the inferred intent and the caller's own facts, so a condition that was already decided is untouched and only an unknown can move. The advisor itself is not changed — it is called with one more argument, synchronously, after the HTTP layer has resolved observations. If the observer is unreachable the request is answered as before and the log says so by name.

[Open the diagram](observation-invariant.architecture.html) — 5 components.

| Component | Responsibility |
|---|---|
| **Agent hook** | Asks the advisor before a tool runs, typing the session so far exactly as the corpus was typed, and turns the verdict into an exit code the agent's runtime understands. |
| **Live resolution** | On a request that carries text, redacts and observes it before the advisor is called, so the advisor stays synchronous and pure and every observation reaches the decision log with its probability. |
| **Jev adapter** | Makes the one network call in either package — one call per distinct redacted text carrying the whole predicate battery — and records which model actually answered. |
| **Observation port** | Defines the one function a model may perform — (text, declared predicate) to a fact or to nothing — and owns the band arithmetic that turns a jittering probability into true, false, or a recorded withholding. |
| **Advisor** | Answers at a decision point using only rules a person marked real, and abstains when a fact is missing rather than treating absence as falsehood; an observed fact enters the fact base first, under everything else, so observation can only add. |

**Deliberately not shown.** The store, which receives which observer answered and every observation with its probability (never the text); the annotation pass and the miner, which the previous question covers; text redaction, which happens inside live resolution before anything is sent.

#### The long read

The live path is the second place. A request may carry what was said at each event; the server redacts and observes it before the advisor is called, so the advisor itself stays synchronous and pure. Whatever comes back enters the fact base first, under the slots, the inferred intent and the caller's own facts. That order is the whole safety argument: a condition that was already decided cannot be changed by adding keys, so only an unknown can move, and verdicts go one way. If the observer is unreachable, the request is answered over typed state and the log says so by name.

The hook on the left is an agent's runtime asking before it acts — Claude Code's PreToolUse seam, here. It types the session so far exactly as the corpus was typed and sends the events with what was said at each. It depends on the free half to do the typing and on loopback HTTP to reach the advisor; nothing about polyx is in the agent's process.

Live resolution is where the text goes first. It is redacted under the corpus profile, the predicates that read it are grouped by text, and the observer is asked once per text. Whatever comes back is re-derived through the predicate's own bands — the arithmetic is the one place a probability becomes a fact, and an observer is not trusted to have done it. Then the advisor is called with the request and the observations, and it does what it always did.

The store gets which observer answered and every observation with its probability, and never the text. The log is thereby a growing annotation file for live traffic, replayable later with no key.

What the diagram cannot show is the property test: every decision point of the synthetic corpus, sixty random rule sets, random observation sets that withhold, assert and refute over every fact a rule could mention, including collisions with slot and caller facts — eight thousand checks that no warning is withdrawn, no abstention created, no verdict moved backwards. With observations applied last instead of first, it goes red.

#### Terms used here

- **observation port** — The interface between polyx and a model that reads text: a function from (text, declared predicate) to a fact, or to nothing. It never decides a verdict.
- **predicate** — A declared, reviewed yes/no question a model may be asked about a text, producing a fact named obs.<name>. Inert until calibrated.
- **withheld** — The model's probability fell between the bands, so no fact is emitted. Recorded as a line with value null; the advisor sees unknown, never false.
- **bands** — Two thresholds per predicate: at or above assertAt emit true; at or below refuteAt emit false; between, withhold. Derived from a labelled sample, never set by hand.
- **annotation** — One recorded model answer for one (site, predicate): its probability, the fact emitted or null, the predicate-set version, the redaction profile, the text hash, and the model that answered.
- **calibration** — Labelling a sample of the corpus by hand, then measuring the model against the labels to derive bands. The labeller never sees the model's answer.
- **decision point** — An episode with a consequential action: the moment the advisor is asked, with what was known before the action.
- **System One model** — A model built for fast, calibrated structured decisions rather than text generation; Jev, from TypeSafe, is the one polyx integrates.

## Boundaries

A boundary is a claim about everything inside it.

### polyx-lens — free

*licence boundary.* Everything here runs without buying anything, imports nothing from the paid half, and can make no network call under any configuration — the dependency runs one way and check:offline fails the build on any code that could reach out

Contains: polyx-lens, Ingest adapters, Alphabet, Pipeline, Ports, Contract sets, Clause checker, The report, Observation port, Predicate sets, Text redaction, Annotation store.

Crossed by:

- **Jev adapter → Observation port** over in-process call. The second implementation of the interface the free half defines; nothing above the interface knows the vendor.
- **Annotation pass → Annotation store** over file. One line per (site, predicate) with p, value or null, the set version, the redaction profile, the answering model.
- **Miner → Annotation store** over file. Recorded facts lifted into each instance's fact base from the sites before it; the digest goes into the manifest beside corpusRevision.
- **Calibration → Predicate sets** over manual. Bands derived from the labelled distribution, precision, withheld fraction, label separation — pasted in by a person and versioned.

### polyx — BUSL 1.1

*licence boundary.* Source-available, internal use granted, Apache-2.0 in four years: the half that turns a corpus into rules nobody wrote down, and the half that is sold

Contains: Miner, Store, Reviewer, Advisor, Evaluator, Three-region diff, Annotation pass, Calibration, Live resolution.

Crossed by:

- **Pipeline → Miner** over in-process call. The same validated records the checker reads. This is the only edge from the free half into the paid one, and it runs in that direction only.
- **Ports → Miner** over in-process call. Every occurrence of a consequential action with the windows around it, and whose evidence a rule rests on.
- **polyx-bench → Evaluator** over file. Decomposed benchmark rulebooks and the gold alignment verdicts.
- **polyx-eval → Evaluator** over file. Clause sets from corpora that cannot be redistributed.
- **Predicate sets → Annotation pass** over file. Only predicates that are real, calibrated, and not stale against this corpus revision; the rest are reported as skipped, never dropped.
- **Text redaction → Annotation pass** over file. The pattern rules and surrogates; a corpus with no profile cannot be annotated, by name.
- **Agent hook → Live resolution** over http. Events so far with type, slots and what was said; the action under consideration; back comes a verdict with the rule's own words and support.

### Answer keys

*ownership boundary.* Written rulebooks decomposed by hand into clauses, used to score the miner and never used by it — a shipped answer key would be a shipped evaluation

Contains: polyx-bench, polyx-eval.

### src/ports/jev — MIT

*licence boundary.* The only code in either package that can make a network call, confined to one directory that nothing outside it may import, and licensed so that 'what leaves my machine?' is the one question nobody has to ask a licence about

Contains: Jev adapter.

Crossed by:

- **Annotation pass → Jev adapter** over in-process call. Redacted text and the whole predicate battery keyed by predicate id; back come probabilities and the model that answered.
- **Jev adapter → TypeSafe API** over https. Redacted text and questions out; `answers` and the answering model id back. The only egress in either package.
- **Calibration → Jev adapter** over in-process call. Only labelled items, once per distinct text, and only after every verdict is in — the labeller never saw p.
- **Live resolution → Jev adapter** over in-process call. Redacted request text; unreachable, budget spent or stale calibration each resolve to no observation and a logged reason.

### The agent's process

*process boundary.* Nothing about polyx is imported here; the hook depends on the free half to type the transcript and on loopback HTTP to reach the advisor

Contains: Agent hook.

## Components

### What was recorded

**Corpora** — Holds the recorded work wherever it already is, because a corpus that has to leave the machine is a corpus nobody will hand over.

- Source: `polyx.config.json`

### Ingest and typing

**Ingest adapters** — Turns each source format into raw interactions with one pure function per format, each held to a field-level fixture test on hand-checked examples.

**Alphabet** — Declares what every event is and what it costs to take back, as a reviewed artefact that is versioned and stamped on every figure derived from it.

**Ports** — Defines how a session is cut, what counts as a subject, and whose evidence a rule rests on — as interfaces rather than as one library.

**polyness** — Supplies the second implementation behind each of the three ports, vendored byte-for-byte so a checkout installs without a sibling repository.

**Pipeline** — Turns raw interactions into validated records in one vocabulary, so everything downstream consumes one shape.

### Observing what was said

**Observation port** — Defines the one function a model may perform — (text, declared predicate) to a fact or to nothing — and owns the band arithmetic that turns a jittering probability into true, false, or a recorded withholding.

- p
- o
- l
- y
- x
- -
- l
- e
- n
- s
- /
- s
- r
- c
- /
- p
- o
- r
- t
- s
- /
- o
- b
- s
- e
- r
- v
- a
- t
- i
- o
- n
- .
- t
- s
- .
-  
- T
- h
- e
-  
- n
- u
- l
- l
-  
- o
- b
- s
- e
- r
- v
- e
- r
-  
- i
- s
-  
- t
- h
- e
-  
- d
- e
- f
- a
- u
- l
- t
- ,
-  
- n
- o
- t
-  
- a
- n
-  
- a
- l
- t
- e
- r
- n
- a
- t
- i
- v
- e
- :
-  
- a
-  
- d
- e
- p
- l
- o
- y
- m
- e
- n
- t
-  
- t
- h
- a
- t
-  
- h
- a
- s
-  
- n
- o
- t
-  
- o
- p
- t
- e
- d
-  
- i
- n
-  
- c
- a
- n
- n
- o
- t
-  
- t
- e
- l
- l
-  
- t
- h
- e
-  
- p
- o
- r
- t
-  
- e
- x
- i
- s
- t
- s
- .

**Predicate sets** — Declares each question a model may be asked, under the same discipline as the alphabet, and refuses at load the one kind of question the measurements showed a model answers confidently and wrongly.

- p
- o
- l
- y
- x
- -
- l
- e
- n
- s
- /
- a
- l
- p
- h
- a
- b
- e
- t
- s
- /
- p
- r
- e
- d
- i
- c
- a
- t
- e
- s
- .
- *
- .
- y
- a
- m
- l
- ,
-  
- l
- o
- a
- d
- e
- d
-  
- b
- y
-  
- s
- r
- c
- /
- p
- o
- r
- t
- s
- /
- p
- r
- e
- d
- i
- c
- a
- t
- e
- s
- .
- t
- s
- .
-  
- `
- q
- u
- a
- d
- r
- a
- n
- t
- :
-  
- s
- e
- q
- u
- e
- n
- c
- e
- -
- u
- n
- k
- n
- o
- w
- n
- `
-  
- i
- s
-  
- r
- e
- j
- e
- c
- t
- e
- d
-  
- w
- i
- t
- h
-  
- J
- F
- 2
- .
- 4
-  
- q
- u
- o
- t
- e
- d
- .
-  
- A
-  
- p
- r
- e
- d
- i
- c
- a
- t
- e
-  
- i
- s
-  
- i
- n
- e
- r
- t
-  
- u
- n
- t
- i
- l
-  
- a
-  
- p
- e
- r
- s
- o
- n
-  
- h
- a
- s
-  
- l
- a
- b
- e
- l
- l
- e
- d
-  
- a
-  
- s
- a
- m
- p
- l
- e
-  
- a
- n
- d
-  
- b
- a
- n
- d
- s
-  
- w
- e
- r
- e
-  
- d
- e
- r
- i
- v
- e
- d
-  
- f
- r
- o
- m
-  
- i
- t
- .

**Text redaction** — Strips identifiers from free text under a declared, versioned profile before a predicate, a labeller or a vendor sees it, and names the profile on every annotation line so a weaker one is identifiable after the fact.

- p
- o
- l
- y
- x
- -
- l
- e
- n
- s
- /
- s
- r
- c
- /
- a
- l
- p
- h
- a
- b
- e
- t
- /
- t
- e
- x
- t
- .
- t
- s
-  
- a
- n
- d
-  
- a
- l
- p
- h
- a
- b
- e
- t
- s
- /
- t
- e
- x
- t
- .
- *
- .
- y
- a
- m
- l
- .
-  
- F
- i
- n
- i
- s
- h
- e
- d
-  
- a
- g
- a
- i
- n
- s
- t
-  
- t
- h
- e
-  
- r
- e
- a
- l
-  
- c
- o
- r
- p
- u
- s
- :
-  
- t
- h
- r
- e
- e
-  
- p
- a
- s
- s
- e
- s
-  
- u
- n
- t
- i
- l
-  
- a
-  
- s
- c
- a
- n
-  
- o
- f
-  
- 2
- ,
- 7
- 2
- 1
-  
- p
- a
- y
- l
- o
- a
- d
- s
-  
- f
- o
- u
- n
- d
-  
- n
- o
- t
- h
- i
- n
- g
- .

**Jev adapter** — Makes the one network call in either package — one call per distinct redacted text carrying the whole predicate battery — and records which model actually answered.

- Source: `src/ports/jev/client.ts`, `src/ports/jev/observer.ts`, `src/ports/jev/LICENSE`

**Annotation pass** — Resolves every site a real, calibrated predicate could read, redacts it, groups by distinct text, asks once per text, and writes the store — or, on a dry run, writes the exact payloads and sends nothing.

- Source: `src/ports/jev/annotate.ts`, `examples/jev-observation/README.md`

**Calibration** — Draws a deterministic sample the reviewer labels without ever seeing the model's answer, then derives bands from the labelled distribution — refusing when the labels do not separate, which is what a question about the world looks like from the labelling chair.

- Source: `src/ports/jev/calibrate.ts`, `src/ports/jev/label-server.ts`

**TypeSafe API** — Answers a battery of yes/no questions over one text with calibrated probabilities in ~200 ms, and names the model version that answered.

### Checking written rules

**Contract sets** — Carries the rules a harness states about itself, decomposed into clauses, with the ones no precedence language can reach recorded alongside the reason.

**Clause checker** — Counts, for every written clause, how often the corpus exercised it and how often it broke it — over the window the clause itself names.

**The report** — Says what could not be named before it says any finding, separates never-violated from never-exercised, and names the question it cannot answer at all.

**polyx-lens** — Runs the whole free half against the transcripts the agent already wrote, with no configuration and no network call.

### Mining unwritten ones

**Miner** — Derives rules the corpus supports, each carrying its support, its provenance level and the records that contradict it.

- Source: `src/mine/index.ts`, `src/mine/patterns.ts`, `src/mine/facts.ts`

**Annotation store** — Holds the model's answers, recorded once in a separate pass, sorted and digested, so that mining reads a pinned file rather than making a call that is not bit-stable.

- p
- o
- l
- y
- x
- -
- l
- e
- n
- s
- /
- s
- r
- c
- /
- p
- o
- r
- t
- s
- /
- a
- n
- n
- o
- t
- a
- t
- i
- o
- n
- s
- .
- t
- s
- ;
-  
- f
- i
- l
- e
- s
-  
- u
- n
- d
- e
- r
-  
- .
- p
- o
- l
- y
- x
- /
- a
- n
- n
- o
- t
- a
- t
- i
- o
- n
- s
- /
- .
-  
- T
- h
- e
-  
- d
- i
- g
- e
- s
- t
-  
- j
- o
- i
- n
- s
-  
- c
- o
- r
- p
- u
- s
- R
- e
- v
- i
- s
- i
- o
- n
-  
- i
- n
-  
- t
- h
- e
-  
- m
- a
- n
- i
- f
- e
- s
- t
- .
-  
- A
-  
- w
- i
- t
- h
- h
- e
- l
- d
-  
- a
- n
- s
- w
- e
- r
-  
- i
- s
-  
- a
-  
- w
- r
- i
- t
- t
- e
- n
-  
- l
- i
- n
- e
-  
- w
- i
- t
- h
-  
- v
- a
- l
- u
- e
-  
- n
- u
- l
- l
-  
- a
- n
- d
-  
- i
- t
- s
-  
- p
-  
- r
- e
- t
- a
- i
- n
- e
- d
- .

### Adjudication and serving

**Store** — Keeps rules, human verdicts and run manifests under an identity stable across re-mining, so a verdict given last week still applies to the rule mined today.

- Source: `src/store/db.ts`, `src/store/rules.ts`

**Reviewer** — Puts one rule in front of a person with the records on both sides of it, and saves the verdict the moment it is given.

- Source: `src/review/server.ts`

**Advisor** — Answers at a decision point using only rules a person marked real, and abstains when a fact is missing rather than treating absence as falsehood; an observed fact enters the fact base first, under everything else, so observation can only add.

- Source: `src/serve/advisor.ts`, `src/serve/coverage.ts`, `test/invariant.test.ts`

**Live resolution** — On a request that carries text, redacts and observes it before the advisor is called, so the advisor stays synchronous and pure and every observation reaches the decision log with its probability.

- Source: `src/serve/observe.ts`, `src/serve/http.ts`

**Agent hook** — Asks the advisor before a tool runs, typing the session so far exactly as the corpus was typed, and turns the verdict into an exit code the agent's runtime understands.

- Source: `examples/claude-code-hook/polyx-hook.mjs`, `test/hook.test.ts`

### Measurement

**Evaluator** — Scores the mined set against a written clause set, reporting recall over the clauses the corpus actually violated beside the headline figure.

- Source: `src/evaluate/index.ts`

**Three-region diff** — Splits mined rules against written clauses into what is followed but never written, what both agree on, and what is written but broken.

- Source: `src/diff/index.ts`

**polyx-bench** — Holds hand decompositions of public benchmark rulebooks, so a published figure can be argued with clause by clause.

**polyx-eval** — Holds the clause sets decomposed from corpora that cannot be redistributed, and is licensed to nobody.

## What moves between them

| From | To | Mechanism | What crosses |
|---|---|---|---|
| Corpora | Ingest adapters | file | Source files — JSONL transcripts, benchmark JSON, an XES event log — read where they already are. |
| Ingest adapters | Pipeline | in-process call | Untyped events with their source features and a pointer back to the file they came from. |
| Alphabet | Pipeline | file | The reviewed rulings: which feature shape is which action, what it costs to take back, and which slots are hashed or tokenised. |
| polyness | Ports | in-process call | Episode boundaries, subject instances and a provenance verdict, behind interfaces polyx owns. |
| Ports | Pipeline | in-process call | The task boundaries a session is cut into, which decide the window every later rule is measured over. |
| Pipeline | Clause checker | in-process call | Validated records: typed events, declared consequence, no free text. |
| Contract sets | Clause checker | file | Written rules with their subject, guard and window — and the ones that cannot be stated, with reasons. |
| Clause checker | The report | in-process call | Per-clause counts with sampled records on both sides, so every figure expands to the sessions behind it. |
| The report | polyx-lens | in-process call | The rendered report, or the same thing as JSON. |
| Pipeline | Miner | in-process call | The same validated records the checker reads. This is the only edge from the free half into the paid one, and it runs in that direction only. *(crosses polyx — BUSL 1.1)* |
| Ports | Miner | in-process call | Every occurrence of a consequential action with the windows around it, and whose evidence a rule rests on. *(crosses polyx — BUSL 1.1)* |
| Miner | Store | database | Proposals carrying support, provenance, and the records that contradict them — a rule without its counter-evidence is a claim, not a finding. |
| Store | Reviewer | database | One proposed rule at a time with the interactions on both sides. |
| Reviewer | Store | database | A person's verdict, with a note and the time it took. |
| Store | Advisor | database | Rules marked real. Nothing else is ever served. |
| Store | Evaluator | database | Every rule with its status, so refusals are scored too rather than quietly dropped. |
| polyx-bench | Evaluator | file | Decomposed benchmark rulebooks and the gold alignment verdicts. *(crosses polyx — BUSL 1.1)* |
| polyx-eval | Evaluator | file | Clause sets from corpora that cannot be redistributed. *(crosses polyx — BUSL 1.1)* |
| Evaluator | Three-region diff | in-process call | Which mined rule answers which written clause, and which of them nobody wrote. |
| Predicate sets | Annotation pass | file | Only predicates that are real, calibrated, and not stale against this corpus revision; the rest are reported as skipped, never dropped. *(crosses polyx — BUSL 1.1)* |
| Text redaction | Annotation pass | file | The pattern rules and surrogates; a corpus with no profile cannot be annotated, by name. *(crosses polyx — BUSL 1.1)* |
| Annotation pass | Jev adapter | in-process call | Redacted text and the whole predicate battery keyed by predicate id; back come probabilities and the model that answered. *(crosses src/ports/jev — MIT)* |
| Jev adapter | Observation port | in-process call | The second implementation of the interface the free half defines; nothing above the interface knows the vendor. *(crosses polyx-lens — free)* |
| Jev adapter | TypeSafe API | https | Redacted text and questions out; `answers` and the answering model id back. The only egress in either package. *(crosses src/ports/jev — MIT)* |
| Annotation pass | Annotation store | file | One line per (site, predicate) with p, value or null, the set version, the redaction profile, the answering model. *(crosses polyx-lens — free)* |
| Miner | Annotation store | file | Recorded facts lifted into each instance's fact base from the sites before it; the digest goes into the manifest beside corpusRevision. *(crosses polyx-lens — free)* |
| Calibration | Jev adapter | in-process call | Only labelled items, once per distinct text, and only after every verdict is in — the labeller never saw p. *(crosses src/ports/jev — MIT)* |
| Calibration | Predicate sets | manual | Bands derived from the labelled distribution, precision, withheld fraction, label separation — pasted in by a person and versioned. *(crosses polyx-lens — free)* |
| Agent hook | Live resolution | http | Events so far with type, slots and what was said; the action under consideration; back comes a verdict with the rule's own words and support. *(crosses polyx — BUSL 1.1)* |
| Live resolution | Jev adapter | in-process call | Redacted request text; unreachable, budget spent or stale calibration each resolve to no observation and a logged reason. *(crosses src/ports/jev — MIT)* |
| Live resolution | Advisor | in-process call | The pure call, with observed facts merged under slots, intent and the caller's facts — so nothing an observation adds can displace a fact already there. |
| Live resolution | Store | database | Which observer answered and every observation with its probability. Never the text. |

## Doctrines, guarantees and trade-offs

### Doctrines

- **Nothing is served that a person has not adjudicated real** a mined regularity is a proposal; some are norms, some are habits, and some are artefacts of how work is scheduled, and only a human can tell which
- **The unknown rate is printed before any finding** the shell parser once dropped two thirds of a corpus's pushes while reporting 1.4% unknown — a rate measured over what the parser understood is not a measurement
- **The low-level libraries stay Apache-2.0; nothing built on them does** polyness is a general library and its licence is deliberate, while the products are sold — Apache explicitly permits inclusion in a work under other terms, provided attribution travels
- **A model may add a fact and may never assert an absence** asked whether income was verified over twelve records equally silent about it, the model answered not-verified twelve times and was right half the time — the closed-world assumption applied perfectly to a partial record; asked whether the text states it, twelve of twelve
- **Bands are derived from a labelled sample, never typed** a hand-set threshold is a closed-world assumption wearing a number; the labeller is never shown the model's answer, so the label is a judgement and not an agreement

### Guarantees

- **No LLM call anywhere in the mining path** the same corpus, alphabet and thresholds must give a byte-identical rule set, or no figure can be reproduced and no rule can be argued with
- **An absent fact is unknown, never false** no record of a verification is not the same as no verification, and in a bank that difference is the product
- **Two build checks, because unreachable and absent are different** check-boundary proves no module READS an answer key, which says nothing about what a git archive contains; check-shippable is the other half
- **Free text never reaches a stored artefact** command bodies, file contents and prompts hold paths, credentials and customer data, so only the verb and a redacted path survive ingestion
- **A verdict given last week still applies to the rule mined today** rule identity is derived from the claim rather than from the run, so re-mining does not orphan a human decision
- **The free half contains no network code at all** nothing leaves the machine has to be inspectable rather than promised, and a corpus that must be uploaded is a corpus nobody will hand over
- **Observation never withdraws a warning and never creates an abstention** observed facts enter the fact base first, under everything else, so a condition already decided is unaffected and only an unknown can move; verdicts go one way, abstain to clear to recommend to warn
- **The model is called in a separate pass and mining reads the recording** a call is not bit-stable — the vendor says similar answers for similar inputs — so byte-for-byte reproducibility requires a pinned file, digested like corpusRevision
- **The vendor is reachable from one directory and the free half can reach nothing** swapping the vendor must change nothing above the port, and the free half's whole claim is that nothing leaves the machine

### Constraints

- **The free half imports nothing from the paid half** a licence split that is only written down is a promise; one that is a dependency direction can be checked by anybody who reads the build
- **An answer key is never distributed to anyone** a shipped answer key is a shipped evaluation, and the decompositions are months of judgement rather than code
- **A contract set ships; an answer key does not** a contract set decomposes what a harness publishes about itself, so it holds for every installation and gives a first run something true to say — same shape, opposite purpose
- **A predicate whose labels separate by less than 0.20 is refused before any band is drawn** with the prompt stating outright that the record might be incomplete, a question about the world still separated its labels by 0.037 — three quantisation steps; the information was never in the text

### Trade-offs

- **The free half cannot find a rule nobody wrote down** everything it reports is measured against clauses that already exist, and the unwritten regularities are what the miner is for — the report says so rather than implying coverage it lacks
- **A predicate costs fifteen positives divided by its base rate, not sixty labels** the first low-base-rate predicate came back ten yes in sixty; the reviewer's hour is the budget and it is spent on the no's — stratify the draw, or expect to redraw
- **The live path fails open** an unreachable observer yields an abstention where an answer might have been, which is the correct failure direction; a hook that blocked every tool when the advisor was down would be hostile

### Risks

- **The vendor's model can move under jev-latest** the response names the model that answered, so every annotation line carries it, the predicate set pins it, and a diff distinguishes a model change from jitter — but nothing prevents the vendor from retiring a version

