# polyx — Technical Specification (MVP)

**Status:** draft for review · 29 August 2026
**Companion to:** polyx Functional Specification (MVP)
**Confidentiality:** commercial. Private polyx repository only.

---

## 1. Architectural stance

Three rules govern every decision below.

**1. polyness sits behind a port, never across the codebase.** polyx defines the interfaces; polyness is the default adapter. No polyx module imports a polyness symbol directly. Dropping the dependency must be an adapter swap.

**2. The predicate language is a column, not a commitment.** Rules are data. Each rule pattern knows how to emit its predicate in a target language, and the MVP ships one target (JS closures). Adding a Datalog target later is a new column in the same table, not a migration.

**3. Every number resolves to records.** Any figure the system prints can be expanded to the underlying interactions in one command. This is inherited from polyness §1.3 and it is the property that makes the rest believable.

### 1.1 Component map

```
                    ┌─────────────────────────────────────────┐
  corpora ────────► │ ingest/          adapters → canonical    │
  (ABCD, τ²,        │                  records                 │
   BPIC, ADP)       └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │ alphabet/       typed events, redaction, │◄── alphabet.yaml
                    │                 outcome classification   │    (per corpus,
                    └───────────────┬─────────────────────────┘     versioned)
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │ PORT: segmentation + subjects            │
                    │  └ adapter: polyness (default)           │
                    └───────────────┬─────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
      ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
      │ mine/oblig   │   │ mine/recommend   │   │ PORT: provenance │
      │ DECLARE-ish  │   │ antecedent→action│   │  └ polyness adptr│
      └──────┬───────┘   └────────┬─────────┘   └────────┬─────────┘
             └────────────┬───────┴──────────────────────┘
                          ▼
                 ┌──────────────────┐
                 │ store/  rule set │◄── adjudications (persisted, keyed on identity)
                 └───┬──────────┬───┘
                     │          │
          ┌──────────▼──┐   ┌───▼──────────────┐   ┌─────────────────┐
          │ serve/      │   │ evaluate/        │   │ diff/           │
          │ advisor API │   │ policy conformance│  │ three-region    │
          │ + abstention│   │ precision/recall  │  │ report          │
          └─────────────┘   └──────────────────┘   └─────────────────┘
```

---

## 2. Stack and repository

**Node 22 LTS, ESM, TypeScript.** polyness is plain `.mjs`; polyx uses TypeScript because it will carry a rule schema across a store and an HTTP boundary, and the schema is the thing most likely to drift. Compile to ESM; no bundler.

**No framework.** `node:http` behind a thin router for the advisor. The MVP has one endpoint.

**Storage: SQLite** (`node:sqlite` on 22, or `better-sqlite3`). Rules, adjudications, evidence pointers and run metadata. A corpus stays on disk as files; only derived artefacts go in the database. Rationale: single-operator, needs transactions and stable identity across runs, and must be inspectable with a standard tool.

**Dependencies stay few and boring.** Every added dependency is a supply-chain question for a commercial product. Note that polyness itself pulls `polyflow` from a pinned GitHub tarball — if the polyness adapter ships, that transitive dependency needs review, and vendoring the handful of modules actually used may be preferable to the npm dependency.

```
polyx/
  src/
    ingest/          adapters: abcd.ts, tau2.ts, bpic.ts, adp.ts
    alphabet/        typing, redaction, outcome classification
    ports/           interfaces + polyness adapters
    mine/            obligation.ts, recommend.ts, patterns.ts
    store/           schema, migrations, rule identity, adjudication
    serve/           advisor, evaluation semantics
    evaluate/        conformance harness, alignment, metrics
    diff/            three-region report
    cli/             polyx audit | mine | review | serve | evaluate | diff
  corpora/           gitignored; fetch scripts only
  alphabets/         alphabet.<corpus>.yaml — reviewed artefacts, committed
  policies/          machine-readable policy clause sets, committed
  test/
  DATASETS.md        licence and attribution register
  NOTICE             Apache-2.0 attributions incl. polyness
```

---

## 3. The canonical record

Everything normalises to this before anything else runs. It borrows the Agent Data Protocol's action/observation split and adds what ADP has no reason to carry: consequence and outcome.

```ts
type InteractionId = string;
type EpisodeId     = string;

interface Interaction {
  id: InteractionId;
  corpus: string;              // 'abcd' | 'tau2:retail' | 'bpic2017' | ...
  actor: ActorRef;             // who handled it — for provenance levels
  startedAt: number;
  events: Event[];
  outcome?: Outcome;           // known later; absent is normal
}

interface ActorRef {
  agentId?: string;            // provenance level 1
  teamId?: string;             //                  2
  operatorId: string;          //                  3  (tenant / merchant / bank)
}

interface Event {
  seq: number;                 // 0-based within the interaction
  at: number;
  episode: EpisodeId;          // assigned by the segmentation port
  kind: EventKind;
  type: string;                // from the alphabet, e.g. 'action:issue_refund'
  slots: Record<string, Scalar>;  // redacted at ingestion
  result?: 'ok' | 'failed' | 'refused';
  raw: RawRef;                 // pointer back to source — never the source itself
}

type EventKind =
  | 'customer_intent'   // a classified customer turn
  | 'customer_utterance'// a customer turn no classifier ruled on (rev. 1)
  | 'agent_utterance'   // an agent turn carrying no action
  | 'action'            // the agent did something
  | 'system'            // the environment responded
  | 'unknown';          // the adapter could not classify — counted, never dropped

interface Outcome {
  label: string;               // 'resolved' | 'escalated' | 'complaint' | ...
  at: number;
  lagMs: number;               // how late it arrived — matters for scheduling
  source: 'in_band' | 'external';
}

interface RawRef { file: string; path: string; }  // JSON-pointer-ish; --show resolves it
```

**`raw` is a pointer, never a copy.** It is what makes every figure expandable, and it is also what keeps redacted text from being re-persisted.

**`unknown` events are counted, never dropped.** An adapter that silently discards what it cannot parse produces a corpus that looks cleaner than it is, and every rule mined from it inherits that lie. F1.2 turns the unknown rate into a gate.

---

## 4. Ingestion adapters

Each adapter is a pure function from source files to `Interaction[]`, with a fixture test asserting field-level output on hand-checked examples.

### 4.1 ABCD — the primary corpus

Source is `abcd_v1.1.json`: a dictionary keyed `train` / `dev` / `test`, each a list of conversations carrying `convo_id`, `scenario`, `original` (speaker–utterance tuples) and `delexed` (the delexicalised version with `<account_id>`-style tokens and per-turn `targets` and `candidates`). Supporting files: `guidelines.json` (the agent guidelines in model-readable form), `ontology.json` (flows, subflows, actions), `kb.json` (intents and button actions).

Mapping:

| ABCD | polyx |
|---|---|
| conversation | `Interaction`, id = `convo_id` |
| speaker `customer` | first customer turn: `customer_intent`, type `intent:<scenario.subflow>` — the scenario's subflow stands in for an intent classifier, since ABCD carries no per-turn intent. Later customer turns: `customer_utterance` (rev. 1) |
| speaker `agent` | `agent_utterance` |
| speaker `action` | **`action`**, type from the button label, slots from the value-filling target |
| `scenario.subflow` | hint only. ABCD has exactly **one** subflow per conversation, so the segmentation ground truth is one episode per interaction, carried as the hint `expected_episodes: 1` and reported by the audit (rev. 1) |
| conversation end state | `Outcome` where derivable |

**Use `delexed`, not `original`.** It is *partly* delexicalised: agent and customer text carry `<account_id>`-style tokens, but action turns still hold the literal values in `targets[3]` and often in their text ("account has been pulled up for crystal minh."). So the adapter drops free text entirely and every slot value goes through redaction. Slot names come from `ontology.json`'s per-button lists only when the value count lines up; otherwise values are `value_0…n` and fall to the wildcard rule (rev. 1).

**ABCD carries no agent ids and no timestamps.** Every conversation is one operator (`abcd`); provenance collapses to operator level on this corpus, and `at` is turn order. Cross-domain provenance (FS §6.4) on ABCD is therefore across *flows*, not across actors (rev. 1).

**`guidelines.json` is evaluation input and MUST NOT reach the miner.** Keep it behind a hard boundary in the code — a separate module that the mining path cannot import. Leaking the answer key into the thing being tested is the single most likely way this evaluation quietly becomes worthless.

### 4.2 τ²-bench — the generated corpus

Not shipped as data. Run the benchmark against a frozen backbone; it writes trajectories to `data/simulations/`. The adapter reads those.

Domains: `retail`, `telecom`, `banking_knowledge` (the last is retrieval-flavoured — expect fewer typed actions and treat it as a stretch, not a primary). Each ships a policy document the agent is given; that document is the evaluation ground truth and is subject to the same hard boundary as ABCD's guidelines.

Tool calls map to `action` events directly — τ²-bench actions are already typed and argumented, which makes this the cheapest adapter to write and a good first one if ABCD parsing proves slow.

Generation must record the backbone, its version, the policy revision, and a seed, in run metadata. Trajectories generated under different backbones are different corpora and must not be pooled silently.

### 4.3 BPIC 2017 — the banking corpus

XES event logs of loan applications. Cases map to `Interaction`; the concept:name of each event maps through the alphabet; lifecycle transitions become `result`. Outcomes are real and in-band (accepted, declined, cancelled).

There is no dialogue and no agent — `customer_intent`, `customer_utterance` and `agent_utterance` are simply absent, and the miner must not assume they exist. This corpus exercises the obligation half only, and is the realism check rather than a source of precision numbers.

Terms not yet read — published for research use and standard in the process-mining literature, so expected to be fine for internal evaluation. Read the landing page once and record it in `DATASETS.md` before ingesting.

### 4.4 ADP — the generic reader

Agent Data Protocol trajectories are alternating actions and observations with three action types (api, code, message) and two observation types (text, web). Map api → `action`, message → `agent_utterance`, observations → `system`. This buys breadth cheaply and is the fallback for any corpus without a bespoke adapter.

---

## 5. The alphabet subsystem

This is the largest change from polyness and the module on which every downstream number depends.

### 5.1 alphabet.yaml

A per-corpus, versioned, human-reviewable artefact. Committed. Never generated without review.

```yaml
corpus: abcd
version: 3
event_types:
  - id: action:issue_refund
    match: { speaker: action, button: [refund, issue-refund] }
    consequence: compensable        # ACV §6.3 — none | reversible | compensable | irreversible
    slots: [amount, order_id]
  - id: action:escalate
    match: { speaker: action, button: [transfer, escalate] }
    consequential: true
    reversibility: irreversible
outcomes:
  - label: escalated
    when: { any_event: action:escalate }
  - label: resolved
    when: { closed_without: action:escalate }
redaction:
  - { slot: account_id, strategy: token }
  - { slot: email,      strategy: hash }
```

Three properties the design must guarantee:

- **Editable without touching source.** F2.1.
- **Versioned, and stamped on every derived figure.** F2.2. A run records its alphabet version; two audits under different versions are distinguishable from their output.
- **Reversible to records.** `polyx alphabet show action:issue_refund` prints the source records assigned to that type. F2.3. This is how an analyst catches the regex that moved a project from "7 pushes, 0 verified" to "14 pushes, 12 verified".

### 5.2 Outcome classification

polyness classifies `passed | failed` from exit codes. There are no exit codes here.

- **ABCD:** derive from flow completion and the presence of an escalation action.
- **τ²-bench:** the benchmark's own verifier provides a task-level result. **It must be used only to label, never to author or select rules** — the PILOT protocol's discipline, and the thing that keeps the evaluation honest.
- **BPIC:** the terminal activity is the outcome.

Outcomes carry `lagMs`. In the MVP every outcome is effectively synchronous; the field exists so the partner case, where it is 90 days, does not require a schema change.

### 5.3 Redaction

Applied at ingestion, before persistence, on the slot map. Three strategies: `token` (replace with a stable per-corpus surrogate, preserving joinability), `hash` (irreversible) and `drop`. Rules name a slot, or `'*'` for every slot not otherwise named (with `except`), or a value `pattern` (`email`, `phone`, `digits`) scrubbed inside any string value. Because even categorical slots typed by a person carry names now and then (ABCD's `membership_level` holds "albert sanders" three times), a slot rule may carry an allowlist — `unless: [gold, silver, bronze, guest]` or `unless_pattern` — and the strategy applies to anything outside it. Free text is not persisted at all — only `RawRef` pointers into the source files, which stay on the analyst's disk (rev. 1).

Tested with a seeded corpus (F1.3): zero occurrences of the seeded identifiers in any stored artefact, checked by scanning the database file itself, not by unit-testing the redactor.

---

## 6. The polyness port

```ts
// ports/segmentation.ts
export interface Segmenter {
  // Local ids ('0', '1', …); the pipeline composes `<interactionId>#<local>`.
  // Async because the polyness adapter wraps an async generator (rev. 1).
  segment(events: Event[], context: { interactionId: string; hints?: Record<string, Scalar> }):
    Map<number /*seq*/, EpisodeId> | Promise<Map<number, EpisodeId>>;
}

// ports/subjects.ts
export interface SubjectExtractor {
  extract(interactions: Interaction[], consequential: Set<string>): Subject[];
}
export interface Subject {
  type: string;
  instances: Instance[];
}
export interface Instance {
  interactionId: InteractionId;
  episodeId: EpisodeId;
  at: number;
  before: Event[];          // same episode
  sessionBefore: Event[];   // same interaction
  all: Event[];
}

// ports/provenance.ts
export interface ProvenanceClassifier {
  classify(rule: Rule, elsewhere: Elsewhere[]): Verdict;
}
export type Verdict =
  | { level: 'agent' | 'team' | 'operator'; kind: 'own' }
  | { kind: 'borrowed'; foundIn: string[] }
  | { kind: 'neither' };
```

`adapters/polyness/*` implements these against the upstream modules. Nothing outside that directory imports polyness. A `NullSegmenter` (one episode per interaction) and a naive in-house extractor exist from day one as reference implementations and as proof the port is real — a port with one implementation is a wish.

**Licence hygiene:** Apache-2.0 requires the licence text, the `NOTICE` contents, and marking of modifications. `NOTICE` is a build artefact, checked in CI.

*As built (rev. 2):* three ports, each with two implementations — segmentation (`null`, `polyness`), subjects (`naive`, `polyness`), provenance (`simple`, `polyness`). The polyness adapters live under `src/ports/polyness/` and are the only files that import a polyness symbol; a test asserts both implementations of every port produce the same rule set on the fixture corpus.

---

## 7. Rule model

### 7.1 Representation

```ts
interface Rule {
  id: string;               // stable across runs — see §7.5
  family: 'obligation' | 'recommendation';
  pattern: string;          // 'no-X-without-prior-Y' | 'antecedent-implies-action' | ...
  bindings: Record<string, string>;   // { subject: 'action:quote_rate', guard: 'action:disclose' }
  conditions?: Condition[];           // data conditions on customer state
  window: 'episode' | 'interaction';
  support: { holds: number; of: number };
  counterexamples: InstanceRef[];     // capped, sampled, always non-empty when of > holds
  provenance: Verdict;
  status: 'proposed' | 'real' | 'not_real' | 'narrowed' | 'retired'
        | 'refused' | 'suppressed' | 'contradicted';   // rev. 2 — see §7.6
  corpusSupport: { holds: number; of: number };  // rev. 2 — operator-wide, when the verdict scope is narrower
  scope: string;            // rev. 2 — the operator the row was mined for; (id, scope) is the row key
  predicates: { js: string };         // the emitter's targets; one for now
  alphabetVersion: number;
  minedAt: number;
}
```

### 7.2 Obligation patterns

The four polyness patterns, restated in DECLARE terms so the formal lineage is explicit and the redundancy literature applies:

| polyx pattern | DECLARE | Window |
|---|---|---|
| `no-X-without-prior-Y` | `precedence(Y, X)` | interaction |
| `X-implies-prior-Y` | `precedence(Y, X)` | episode |
| `at-most-one-X` | `absence2(X)` | episode |
| `exactly-one-Y-per-X` | `co-existence` + `absence2(Y)` | episode |
| `no-X-without-prior-Y-same-S` | `precedence(Y, X)` over one value of S | interaction |

*The fifth pattern (rev. 13)* looks inside an event. Where the alphabet declares a slot an **identity** (`identity: [file]` on an event type — declared, never inferred, because a same-value rule over a slot that is not one, "read a `.ts` file before editing a `.ts` file", is true, well supported and useless), the guard must carry the subject's own value: *read this file*, where `X-implies-prior-Y` accepts a read of any file. Its guard is a set — every type sharing the slot that preceded the subject on the same value at least `minInstances` times, capped at `maxGuardRules` — because the norm it was built for has two ways to be met: Claude Code will not edit a file it has neither read nor written, and on the cc corpus a same-file read preceded 1,635 of 3,930 edits in the session while a read or whole write preceded 3,426. There is one candidate per subject, slot and condition, whose set is the union of what each operator found; scored separately, the narrower set implied the wider one out of the proposed set at every operator. It is measured over the contact, since the read that licenses an edit is routinely several prompts earlier, and it implies the type-level `no-X-without-prior-Y` when its set has one member.

At serve time a contact-window rule needs the contact. `POST /advise` carries it as `contact.events` (types and slots only), and the considered action's slots as `consideringSlots`; without the one a contact-window rule is satisfied by a guard in the episode and otherwise abstains on `contact`, and without the other a same-slot rule abstains on `considering.slot.<S>`. Before rev. 13 a contact-window rule was checked against the episode alone, and a guard two prompts back read as a guard that never happened.

**What moved (rev. 13), on the two corpora that share the cc alphabet** — every other corpus reproduces unchanged, the what-if coverage included. `cc`: proposed 2,802 → 2,827, the 25 same-file rules, one per project, at 87–100% support where a project has more than a hundred edits (913/990, 578/605, 560/623), each with a guard set of two and so implying no type-level rule; precision 0.0300 → 0.0297, still uninterpretable against a partial policy, recall unchanged. The coverage ceiling's warned share fell 0.978 → 0.946 and its cleared share rose 0.001 → 0.015: that is the replay now sending the contact, so a contact-window guard two prompts back clears instead of warning. Coverage itself fell 0.979 → 0.961, and all of it is 40 points abstaining on `slot.ext`: a rule conditioned on it used to be masked by a false warning from another rule, and with that warning gone the unknown condition is what remains to say. `cc-mimo`: proposed 117 → 125, refused 132 → 142, refusal correctness 0.879 → 0.887.

Extended for CRM with **data conditions**: `precedence(disclose, quote) where product.type = 'mortgage'`. This is the data-aware Declare extension and it is what makes the patterns useful in a domain where the same action means different things in different contexts.

**Redundancy pruning is required, not optional.** Declarative discovery is notorious for emitting hundreds of true, useless constraints, and polyness's `maxGuardRules: 3` cap is a blunt stand-in. Implement subsumption: a rule implied by another proposed rule is suppressed and recorded as suppressed.

*As built (rev. 2):* two implications are pruned mechanically — the interaction-window twin of a proposed episode-window precedence rule, and a precedence rule implied transitively by two proposed ones. A rule nothing in the corpus could have violated is marked *vacuous* and suppressed rather than proposed. Two patterns test it, each over the window it is measured on: `at-most-one-X` where X never repeats in an episode, tested before the rule is ever a candidate; and `no-X-without-prior-Y` where the guard already preceded the subject in every contact, tested *last*, over what still stands after contradictions and subsumption, so that a relational verdict naming another rule always wins (rev. 11, rev. 12). Data-conditioned variants are emitted only where the plain rule fails its floor, only when the condition **discriminates** (the rule must fail where the fact is known and different — otherwise it is the fact being known, not its value, doing the work), and at most `maxGuardRules` per base rule, ranked by coverage. Own evidence below a pattern's implication floor is a habit, not an obligation, and is not a candidate; the absence of own evidence at any confidence is a *refusal* and is kept (§7.6).

**Candidates are scored everywhere they are not found (rev. 2).** A candidate is identified by what it says, not where it was found: every candidate any operator's history produces is measured at every operator. That is where `neither` verdicts come from — the rule alpha keeps, scored against beta's history — and it is the mechanism behind the cross-domain provenance experiment (FS §6.4).

### 7.3 Recommendation patterns

A different shape and a different evidence standard:

```
antecedent (conjunction of conditions on episode state and customer facts)
  → suggested action
  with precision measured against what was actually done,
  and against the outcome that followed
```

Two figures, not one: **agreement** (the action taken matched) and **outcome-conditioned precision** (of the times it matched, how often the outcome was good). A rule that reproduces what agents do badly is a faithfully mined mistake, and only the second figure catches it.

Antecedent search is bounded: conjunctions up to length 3, over conditions drawn from the alphabet's slot vocabulary, with a minimum instance floor. Beyond that the search explodes and the rules stop being readable, which defeats the purpose.

### 7.4 Provenance lattice

Four levels, evaluated in order, stopping at the first that yields own evidence:

```
agent  →  team  →  operator  →  borrowed(other operators)  →  neither
```

The verdict names the level. "Own evidence at operator level" and "own evidence at agent level" are different claims, and a reviewer will care which — a rule that holds for one agent and not their team is a personal habit, not a norm.

*Reading (rev. 2):* the lattice is evaluated **broadest first** — operator, then each team, then each agent, then borrowed, then neither — and the verdict names the broadest level at which own evidence exists. A rule that holds operator-wide is a norm; one that holds only for a team is a team norm; one that holds only for one agent is a personal habit. The support quoted is the support at that scope; the operator-wide figure rides along as `corpusSupport`. The single-level judgement (own / borrowed / neither from a support and the same rule's support elsewhere) is the provenance port; polyness's `classify` is one implementation of it and an in-house one is the other.

*Warrant is a second axis (rev. 8).* The lattice above answers **what my own
history says**. It cannot answer **where this rule came from**, and the two are
independent. A rule a vendor ships with their MCP server is *asserted by an
authority*; `borrowed` is an empirical measurement — it holds for at least
`borrowedOperators` other operators, which is a fact about data, not a claim
about who is speaking. Collapsing an assertion into `borrowed` would report a
vendor's undemonstrated rule and a rule measured across three real operators
as the same verdict, and they are not the same.

So warrant is recorded **orthogonally** to the evidence lattice, not as a
fifth level on it:

```
              warrant:  mined-here          asserted (vendor / body / team)
  evidence:
  own@operator          strongest           strongest — and it conforms
  own@team / agent      a local norm        conforms narrowly; ask why
  borrowed              a cross-operator    holds elsewhere, unverified here
                        regularity
  neither               refused (F4.4)      DOES NOT HOLD HERE — the finding
```

The bottom-right cell is the product: an asserted rule with no local evidence
is not a failure to mine, it is a **conformance gap against the party that
asserted it**, and it is the one cell that neither axis alone can name. This
is why replay changes job under bounded-system sharing — from "why believe a
stranger?" to "where does your system disagree with its vendor?".

Not built. There is no import path yet, and a column with one value in it is
not a design — it is a guess with a schema. It lands with the bundle reader.

### 7.5 Rule identity

`id = hash(family, pattern, canonicalised bindings, canonicalised conditions, window)`.

Deliberately **excludes support figures**, so that re-mining an unchanged corpus yields the same ids and adjudications survive (F4.3, F5.2). Adding interactions changes support, not identity. Changing the alphabet changes the bindings' vocabulary and therefore *should* change identity — which is correct, because it is a different rule about a differently-defined event.

### 7.6 Lifecycle

```
proposed ──review──► real ──────► served by the advisor
    │                 │
    │                 └──support drops below floor──► retired (reason recorded)
    ├──review──► not_real  (not re-proposed unless support moves ≥ δ — F5.3)
    └──review──► narrowed  (reviewer adds a condition; re-mined as a new rule,
                            linked to its parent)
```

`retired` exists because nobody ever deletes a line from a memory file, and that is why memory files rot. Retirement is automatic on evidence and always carries its reason.

*As built (rev. 2):* three more statuses exist so that nothing the miner decided is lost between runs — `refused` (no own evidence at any level, F4.4; kept because refusal correctness is measured over exactly these), `suppressed` (implied by another proposed rule, or vacuous; carries `suppressedBy`) and `contradicted` (member of a mutually exclusive pair, F4.6). These three are recomputed every run and never reviewed; `real`, `not_real` and `narrowed` are the human's and survive re-mining keyed on identity. A rule that stops being mined is retired with "not mined by run …". A retired rule that clears the floor again is re-proposed with the reason shown. **A rule row is (identity, scope):** the same rule mined for two operators is two rows with their own support, status and adjudications, and one identity.

---

## 8. The advisor

### 8.1 Evaluation semantics

Forward chaining over a fact base, not backward chaining over goals. The query is "given this state, what fires?", which is a fixpoint, not a proof search.

**Three-valued, and this is the load-bearing part.** Each condition evaluates to `true`, `false`, or `unknown`. A fact absent from the request is `unknown`, never `false`.

| Antecedent | Result |
|---|---|
| all conditions `true` | rule fires |
| any condition `false` | rule does not apply |
| no condition `false`, at least one `unknown` | **abstain with `unknown_fact`**, naming the fact |

Closed-world assumption is prohibited. "No record of income verification" is not "income was not verified", and in a bank the difference is the whole product. F6.3 tests exactly this.

### 8.2 Contract

```
POST /advise
{
  "operator": "...", "agent": "...",
  "episode": { "events": [ ... ] },        // canonical events so far
  "facts":   { "customer.tenure_months": 14, "product.type": "mortgage" },
  "considering": "action:quote_rate"       // optional
}
→
{
  "verdict": "recommend" | "warn" | "abstain",
  "actions":  [ { "type": "action:offer_product", "product": "...",
                  "rules": [ { "id": "...", "support": "41/47",
                               "provenance": "own@team",
                               "evidence": "/rules/<id>/evidence" } ] } ],
  "warnings": [ { "rule": "...", "unsatisfied": "action:disclose" } ],
  "abstention": { "reason": "uncovered" | "unknown_fact",
                  "missing": ["customer.income_verified"] },
  "coverage": { "decisionPoint": "quote_rate", "answered": true }
}
```

Serves only `status: 'real'` rules (F6.4). Every response is logged as a decision point with its verdict — that log is the coverage measurement in §9.3 and, later, the corpus for the next mining pass.

### 8.3 Performance

500 rules, p95 < 50ms (F6.5). At that scale a plain indexed scan over rules keyed by subject type is sufficient; RETE is not needed and would be premature. Index rules by `bindings.subject` and by the conditions' fact keys; evaluate only the candidate set.

---

## 9. Evaluation harness

The most important subsystem and the one most likely to be built carelessly.

### 9.1 Policy clause sets

Each policy is decomposed once, by hand, into atomic clauses, and committed under `policies/`:

```yaml
policy: abcd-guidelines
version: 1
clauses:
  - id: c-017
    text: "Verify the customer's identity before discussing account details."
    expressible: true            # can polyx's rule language state this at all?
    shape: precedence
    subject: action:discuss_account
    guard: action:verify_identity
  - id: c-041
    text: "Be polite and empathetic."
    expressible: false           # counted in the denominator of nothing
```

**`expressible` is doing real work.** Recall is reported over expressible clauses only, and the count of inexpressible clauses is reported alongside — because "polyx recovered 60% of the policy" and "polyx recovered 60% of the third of the policy it can even represent" are very different claims, and only the second is honest.

### 9.2 Alignment

Matching a mined rule to a clause is the weakest step in the whole system (F8.3).

- **Proposal:** an LLM-assisted matcher scores candidate (rule, clause) pairs.
- **Adjudication:** a human confirms or rejects on a sample.
- **Reporting:** a gold alignment on ≥ 100 pairs, with inter-rater agreement reported. Headline precision/recall are computed against the gold set, and the automated matcher's own agreement with gold is reported separately as a known source of error.

Anything less and the headline number measures the matcher, not the miner.

### 9.3 Metrics

```
precision            = |mined ∩ gold-aligned| / |mined proposed|
recall               = |clauses recovered| / |expressible clauses|
refusal_correctness  = |refused ∧ absent from policy| / |refused|
coverage             = answered / (answered + abstained)
abstention_split     = uncovered : unknown_fact
agreement            = recommendation matched the action taken
outcome_precision    = P(good outcome | rule fired ∧ followed)
inference_displaced  = decision points answered without a model call
```

Every metric emits with the alphabet version, corpus revision, backbone (where generated), thresholds and seed. A metric without that stamp is not reproducible and should not leave the machine.

### 9.4 The τ²-bench confounder control

Because the τ²-bench agent is handed its policy in the prompt, recall on that corpus is inflated. Two controls, both required (§6.2 of the functional spec):

1. Report a second recall figure over the **violated-at-least-once** clause subset.
2. Include failed and abandoned trajectories in the corpus.

Both are properties of the harness, not of the analysis, so they belong in code rather than in a caveat.

---

## 10. Conformance diff

Given a mined rule set and a policy clause set, both already aligned (§9.2):

- **mined ∧ ¬written** → *tribal knowledge*
- **mined ∧ written** → *confirmed*
- **¬mined ∧ written** → *compliance gap* — with the distinction, made explicit, between *violated in the corpus* and *never exercised in the corpus*. Conflating them turns "your reps ignore this rule" into "this situation never arose", which is the difference between a finding and an embarrassment.
- **contradictions within the mined set** → reported separately

Output is HTML with every finding linked to its interactions. Every alignment is labelled as proposed-for-confirmation.

---

## 11. Non-functional requirements

**Determinism.** Same corpus + same alphabet version + same thresholds → byte-identical rule set. Enforced by a test that mines twice and diffs. Any LLM call in the mining path would break this, which is why there are none — the LLM appears only in evaluation alignment, where its output is human-adjudicated.

**Traceability.** Every printed figure expands to records in one command.

**Privacy.** No free text persisted. Redaction before persistence. The database is scanned for seeded identifiers in CI.

**Reproducibility.** Every run writes a manifest: corpus revision, alphabet version, thresholds, seed, code commit, and — where generated — backbone and policy revision.

**Thresholds are configuration and are reported.** Every floor is externalised, and the evaluation reports sensitivity across a sweep rather than a single tuned value. The inherited numbers came from one dev-tool corpus and are circular there; this is the first honest second domain, and treating them as settled would repeat the error knowingly.

---

## 12. Testing

- **Adapter fixtures** — hand-checked interactions per corpus, asserted field by field.
- **Alphabet round-trip** — every event type resolves back to its source records.
- **Redaction** — seeded corpus, database scanned, zero hits.
- **Determinism** — mine twice, diff.
- **Identity stability** — re-mine unchanged corpus, ids unchanged; add an interaction, ids unchanged and support moved.
- **Three-valued advisor** — remove a required fact, assert `abstain` rather than a changed answer. The single most important test in the system.
- **Provenance** — a synthetic corpus with a known per-operator split produces the expected verdicts at the expected levels.
- **Contradiction detection** — seeded mutually exclusive pair is reported, not proposed.
- **Boundary test** — a static check that no module under `mine/` imports from `evaluate/policies` or any guidelines file. The answer key must be structurally unreachable from the thing being tested.

---

## 13. Twelve weeks

| Wk | Build | Exit condition |
|---|---|---|
| 1 | Repo, canonical record, SQLite schema, CLI skeleton, ADP adapter | `polyx audit` runs on an ADP sample |
| 2 | ABCD adapter, alphabet subsystem, redaction | Audit on ABCD; redaction test green |
| 3 | Segmentation + subjects ports, polyness adapter, null adapter | Both adapters produce episodes; quality figure reported |
| 4 | Obligation patterns, support, provenance lattice, review CLI | Candidate rules with evidence and counter-evidence |
| 5 | Policy clause set for ABCD guidelines, alignment tooling | 100-pair gold alignment, inter-rater reported |
| 6 | **Evaluation harness; first precision / recall / refusal figures** | **The falsifiable claim, measured. Go / no-go.** |
| 7 | τ²-bench generation + adapter | Trajectories under a frozen backbone, manifested |
| 8 | Cross-domain provenance, threshold sensitivity sweep | Where borrowed evidence lands, and how the floors move it |
| 9 | Recommendation patterns, antecedent search, dual precision figures | Recommendation rules that clear the floor — or the finding that they do not |
| 10 | Advisor: three-valued evaluation, HTTP contract, coverage logging | Live `/advise`; abstention test green |
| 11 | BPIC adapter (licence permitting), obligation mining at scale | Banking realism check |
| 12 | Conformance diff, HTML report, packaging | The three-region report end to end |

Week 6 gates weeks 7–12. If precision lands in the falsification range, the response is to revisit the pattern table and the alphabet — not to build the advisor on top of a miner that does not work.

---

## 14. Risks

| Risk | Effect | Response |
|---|---|---|
| **Answer-key leakage** — guidelines reach the miner | Evaluation silently meaningless | Structural boundary + CI import check (§12). Treat as a correctness bug, not hygiene. |
| **Alignment dominates the metric** | Headline number measures the matcher | Gold set, inter-rater agreement, matcher error reported separately (§9.2) |
| **Recommendation rules too sparse** | The advisor half does not clear the floor | Discovered at week 9, by design. Fallback: obligation-warning service, a smaller but real product. |
| **Episode segmentation is poor on dialogue** | Every window rests on sand | Evaluate against ABCD subflow labels, which are ground truth for exactly this |
| **Dataset terms** | Low — nothing is redistributed or shipped | ABCD and τ²-bench are MIT and carry the headline evaluation. Read BPIC's and Kaggle's terms once and record them in `DATASETS.md`. Keep evaluation corpora separable from product artefacts so the numbers-out / artefacts-in line stays easy to hold. |
| **polyness divergence** | Coupling to a corpus with different assumptions | Port discipline + a second implementation from day one |
| **Thresholds still circular** | Numbers that do not transfer | Report sensitivity, never a tuned point value |
| **τ²-bench confounder unaddressed** | Inflated recall, credibility loss on first expert reading | Both controls in the harness, not in the prose (§9.4) |

---

## 15. Revision log

**rev. 16 — 9 Sep 2026. A clause is measured over the window it names (`cc-policy` v4).**

Building the free lens surfaced this: `exerciseClauses` measured every clause over `i.before` — the EPISODE — no matter what the clause said. The Edit tool's contract says *"you must Read the file **in this conversation** before editing"*, and on a corpus whose sessions hold twenty tasks, checking a conversation-scoped rule per task turns compliance into violation.

`Clause` and `Contract` now carry `window: episode | interaction`, absent meaning `episode` — the stricter reading, and the correct one wherever a contact holds a single task. Seven `cc-policy` clauses declare `interaction`, the same seven as `contracts/claude-code.yaml` in polyx-lens and for the same reasons: they are the same rules, and a clause cannot mean one thing when the product checks it and another when the evaluation does.

**What was being reported, and what is true:**

| clause | per episode | as written |
|---|---|---|
| `cc-read-before-edit` | 1,919 of 3,930 violated | **273** |
| `cc-read-before-write` | 1,833 of 2,330 | **587** |
| `cc-read-before-publish` | 64 of 72 | **30** |
| `cc-write-before-publish` | 29 of 72 | **1** |
| `cc-skill-before-publish` | 58 of 72 | **1** |
| `cc-toolsearch-before-browser-drive` | 139 of 299 | **0** |

Seven times overstated on the largest of them. The last row is the one that matters most: measured as written, the ToolSearch instruction is kept **299 of 299** — which is what the miner said (9/9, 12/12, 5/5 own@operator) and what the lens says, so three independent paths now agree where two of them previously did not.

**What moved in the published figures: almost nothing, and that is the uncomfortable part.** `cc` recall-over-violated-only 0.867 → 0.857, because one clause left the violated-at-least-once set. Headline recall, precision and the diff regions are unchanged, and ABCD, τ², `cc-mimo` and synthetic are untouched — one task per contact means the two windows coincide, which is exactly why this survived so long. **Every per-clause compliance statement about `cc` made before today was wrong, while every aggregate stayed within a hundredth.** An aggregate that is insensitive to a 7× error in its parts is not validating those parts.

**Alignment still ignores the window, deliberately.** `align.ts` matches a mined rule to a clause on `(subject, guard)` alone, which is why headline recall did not move. polyx mines both windows and subsumption prunes the twin, so the pair is the right key for *recovery*; the window is a property of the claim, not of whether the claim was found. Revisit if a corpus ever shows an episode rule recovering a clause its own text scopes to the session — nothing here does yet.

**rev. 15 — 7 Sep 2026. The `cc` adapter was reading two thirds of the pushes out of the corpus (alphabet v5).**

A code review of the branch, which probed the real corpus rather than reading the diff, found that `segments()` truncated the entire shell command at the first `<<`. The intent was right — a heredoc body is data and may contain anything — but the implementation discarded every command *after* the terminator too. Measured: 3,598 of 18,675 shell calls contain `<<`, and 2,748 of those had real commands thrown away.

Three parser defects compounded it, all in the same direction (fewer actions, quieter unknown rate):

- **The heredoc truncation**, above. Fixed by skipping only from `<<TAG` to the line matching `TAG`. `<<<` is a here-string with no body and is now excluded.
- **`VAR=$(cmd …)` was read as a bare assignment.** The token `KEY=$(aws` matched the leading-assignment pattern, so the head verb was skipped and the sub-verb became the verb: `verb=secretsmanager`, matching nothing. 434 segments, `aws` ×122 among them. A substitution *runs* its command, so it is unwrapped rather than skipped.
- **The quote scanner ignored backslash escapes**, so `\"` closed a quoted region and an inline script body split on its own newlines into pseudo-commands (`verb=const` ×117). The danger is not the noise: the same mechanism emits a *matched* phantom action whenever a line inside a string starts with a real verb, inventing an action that never ran — which is exactly what the `sess-bbbb` fixture exists to prevent.
- **14% of segments were dropped in silence.** `if (!v) continue` discarded 8,382 of 59,537 segments, only 2,815 of them shell keywords, while the file's header promised "an event the adapter discards is an event no unknown-rate ever counts". Shell syntax is still dropped — that is the documented and defensible class — and everything else is now emitted without a verb, so the alphabet counts it unknown where it can be seen.

**What the corpus actually contains:** events 102,927 → **111,926**, and `action:git_push` **222 → 654**. Two thirds of this corpus's irreversible pushes were invisible to every figure published before today. The unknown rate rises 1.4% → 3.5%, which is not a regression: it is the first honest measurement, taken over every segment rather than over the ones the parser happened to understand. The gate is 20%.

**What moved, on the two corpora this adapter feeds.** `cc`: events 102,927 → 111,926, unknown rate 1.4% → 3.5%, proposed 2,758 → 2,802, tribal 2,640 → 2,671, contradictions 443 → 460, awaiting alignment 34 → 47, precision 0.0305 → 0.0300 (uninterpretable either way — partial policy), **recall unchanged at 0.867**, confirmed unchanged at 84. `cc-mimo`: events 14,224 → 14,246, proposed 116 → 117. Every other corpus is untouched — no other adapter shares this code.

Two clause-level movements are worth naming. `cc-polysim-cloud-test-before-commit` reads **VIOLATED 37 of 159** where it read 40 of 141: both sides of that clause — `npm test` and `git commit` — were in the dropped set, so neither its numerator nor its denominator meant anything before. `cc-skill-before-browser-drive` is unchanged at 299 of 299, as it must be: its subject and guard are `tool_use` blocks, not shell segments, so nothing rev. 13 and rev. 14 measured passed through the broken parser. That the skill finding survives a two-thirds correction to the corpus is the strongest thing that can be said for it.

**The lesson the review taught, stated so it is not learned twice.** All four parser defects failed in the same direction: fewer actions, and a quieter unknown rate that hid the loss. A parser that drops what it cannot read will always look better than one that counts it, and §11's reproduction pass cannot see the difference because both are deterministic. The unknown rate is only a guarantee if every segment reaches it.

**Four smaller defects from the same review, fixed here.** `projectOf`'s fallback only stripped Windows-shaped path prefixes, so a macOS or Linux transcript directory left the username in the operator id — the one outcome its docstring exists to prevent. `git -C tmp push` read as `git tmp` because the flag's value was skipped by shape (does it contain a slash) rather than by name. The interrupt marker matched the phrase anywhere in a message, so a session that merely *discussed* an interruption had its outcome flipped — and this corpus contains the sessions in which this adapter was written. The id-collision suffix `${r.id}-${seen.size}` depended on how many sessions had been read before it, so adding one transcript renumbered colliding interactions and silently repointed the store's adjudications; it now counts occurrences of that id.

Event ordering is fixed with them. The transcript stamps one timestamp per record, several events share it, and `applyAlphabet` sorts by `at` — so a later record's event could sort between two segments of an earlier command. The whole miner is a before/after question, so this was not a presentation detail. Events now carry strictly increasing timestamps within an interaction.

**Alphabet v5** closes two unreachable rules the same review found: `pip`, `pip3` and `gem` are not adapter multiplexers, so no `sub` feature is ever produced for them and `action:package_install` could never match — `verb=pip` sat in the unknown table. Same defect for `pytest`, `jest` and `vitest` on `action:run_tests`. Both now have a bare-verb entry.

Two things outside the adapter, from the same review. `corpora/link-cc.mjs` ran `rmSync(recursive, force)` on an unvalidated `--out`, so `--out ~/code/polyx` would delete the repository before the first check; it now refuses any directory that is neither empty nor a previous run of itself. And `scripts/reproduce.mjs --write` replaced `docs/results.json` wholesale, so a contributor without the private `cc` corpus silently deleted its committed rows — it merges now, and says which corpora it kept.

**rev. 14 — 7 Sep 2026. Two written rules for the same action, and the corpus decides (`cc` alphabet v4, `cc-policy` v3).**

Rev. 13 left the browser clause VIOLATED 299 of 299 with a hypothesis attached: the preamble is not being ignored, it is losing to a competing instruction. The harness's own MCP instructions say *"load them with ToolSearch before calling them"* for the same tools the `claude-in-chrome` skill says to invoke itself before. Two written rules, both in force, same subject, different guards — and only one of them was checkable, because alphabet v2 typed `ToolSearch` as `system:bookkeeping` beside `TaskCreate` and `ExitPlanMode`, and a guard must be an action. `cc-policy` had already recorded that as an inexpressible clause with the note *"worth revisiting at the next alphabet review."* This is that review.

**`ToolSearch` is a step (v4).** Loading a deferred tool's schema is the exact analogue of loading a skill — a deliberate preparatory act the agent chooses, without which the next call cannot be made — and `action:load_skill` is an action for that reason. It becomes `action:load_tools`. 188 events move from `system` to `action`, which is why the mined set grows.

**The measurement:**

| written rule | verdict |
|---|---|
| load the **browser skill** before driving the browser | **VIOLATED 299 of 299** — the skill is never loaded in the corpus at all |
| load the **tools with ToolSearch** before driving the browser | **CONFIRMED** — 9/9, 12/12 and 5/5 `own@operator` in three projects; 43/125 and 35/76 borrowed elsewhere |

Where the behaviour follows a written rule for this subject, it follows the harness's, not the skill's. The finding is about the written rules — one of them is dead text competing with a live one — which is what §10 says the diff is for.

**The skill source, decomposed in full.** `cc-policy` v3 stops carrying only the skill clauses that happened to be expressible. Eight load-before-use instructions are now recorded: three expressible (`artifact-design` → publish, the browser skill, the ToolSearch instruction) and five not — `dataviz` (subject is a property of the file's content), `claude-api` (antecedent is a property of the prompt text), `artifact-capabilities` (conditional on intent and on an argument value), `artifact-diagramming` (conditional on what the page contains), `workflow-authoring` (no type names a `Workflow` call; `action:spawn_agent` covers `Agent` and `Workflow` together and the corpus has 0 Workflow calls to justify splitting). The general `cc-toolsearch-before-deferred` stays inexpressible for a *new* reason — "a deferred tool" is a property of dozens of types, not one — and is not counted twice now that its browser instance is a clause.

That ratio is the answer to what a skill can become: **of eight quotable load-before-use instructions, three are checkable at all, and of those three one is confirmed, one is dead, and one is the rule that actually governs.** Most of a skill is not expressible as precedence over typed actions, and saying so with a count is better than saying it with an adjective.

**What moved on `cc`:** clauses 24 → 30, expressible 14 → 15, inexpressible 10 → 15; proposed 2,698 → 2,758; confirmed 79 → 84; tribal 2,585 → 2,640; gap 2 and contradictions 443 unchanged; recall 0.857 → **0.867** (13 of 15); precision 0.0293 → 0.0305, still uninterpretable against a partial policy. `cc-mimo` shares the alphabet and clause set: its rule set is unchanged at 116 proposed, and its recall moves 0.143 → 0.133 only because the denominator gained a clause it never exercises (never-exercised 10 → 11).

**rev. 13 — 7 Sep 2026. A written rule that names a thing must be checked against that thing (`cc` alphabet v3, `cc-policy` v2).**

Two of `cc-policy`'s clauses come from skill preambles, and both name a skill: *"load the artifact-design skill before publishing a page"*, *"always invoke the browser skill before driving the browser"*. Both were decomposed with `guard: action:load_skill` — **any** skill — because the alphabet had one type for every `Skill` call. A guard that fires on having loaded something else is not the rule the preamble states, and the figures it produces are not about that rule.

The fix is typing, not mining. The `cc` adapter now publishes a `Skill` call's `skill` as a matchable **feature** (it was already a slot; `classify` reads features only), and alphabet v3 gives the two skills a written rule names their own type ahead of the general `action:load_skill`, which still catches the rest. The same argument applied a second time to the subject: `action:browser_drive` matched two tool families — 318 `claude-in-chrome` calls and 444 `chrome-devtools` calls — and only the first has a preamble stating a load-before-use order, so the clause was being measured over 444 calls that state no such rule. v3 splits them. Typing all ~40 skills by template (`${skill}`) was considered and rejected: it shatters the general "load a skill" guard that 95-of-95 rules rest on, to buy types for skills no clause names.

**What the sharpened clauses say.** The publish clause stays **confirmed** and now reads as written — *"before you publish a page, load the artifact-design skill"*, 7 of 8, `own@operator` — so the confirmation was not an artefact of any-skill loading. The browser clause moves the other way: measured over the surface it names, it is **VIOLATED 299 of 299**. The `claude-in-chrome` skill is never loaded in the corpus at all; the 7 apparent compliances at v2 were sessions that had loaded some other skill. A person still has to rule on it, and the likely reading is not simple non-compliance: the harness's own MCP instructions tell the agent to load those tools through `ToolSearch`, so two written sources disagree and the preamble is the one that lost. That is a finding about the written rules, which is what §10 says the diff is for.

**What moved on `cc`:** proposed 2,703 → 2,698, contradictions 472 → 443, tribal 2,590 → 2,585, confirmed 79 unchanged, gap 2 unchanged, recall unchanged at 0.857, precision 0.0292 → 0.0293 (still uninterpretable — partial policy). `cc-mimo` shares the alphabet and every figure is unchanged: it contains neither corpus's named skills. The change is surgical by construction — it renames two guards and one subject and touches nothing else.

**rev. 12 — 4 Sep 2026. The vacuity test, over the window it measures.**

Rev. 11's test read `sessionAll` — the whole contact, *including events after the subject* — while `no-X-without-prior-Y` is measured over `sessionBefore`. That is not a vacuity test. A contact whose guard occurred only *after* the subject counted as "already contained the guard", so rules the corpus demonstrably violated were suppressed as uninformative: τ² retail's *"before you modify the user's default address, look up the order"* at **32 of 39** — the single rule rev. 11 removed, and the whole of its headline "precision rises, recall unmoved" — 3 of `cc-mimo`'s 4, worst at 19 of 30, and **444 of the 1,095** `cc` rules it suppressed, which is where the recall drop 0.857 → 0.786 and the lost written clause came from. Measured over `sessionBefore`, vacuous ⟺ support is 1.0, the exact analogue of `at-most-one`, and the case that motivated the test is still caught: `cc`'s *"listed a directory"* guard preceded the subject 324 of 324 times. `Instance.sessionAll`, added in rev. 11 for this and used nowhere else, is removed from both extractors.

**What moved** — every figure at rev. 10 (before any vacuity test existed on this pattern), at rev. 11 as committed, and now:

| corpus | proposed (rev. 10 → 11 → 12) | precision strict | recall |
|---|---|---|---|
| synthetic (oracle) | 13 → 13 → 13 | unchanged | planted answer key reproduced exactly |
| ABCD | 150 → 149 → **150** | 0.529 → 0.535 → **0.529** | unchanged, 0.529 |
| τ² retail | 21 → 20 → **21** | 0.524 → 0.550 → **0.524** | unchanged, 0.733 |
| `cc` | 3,351 → 2,256 → **2,703** | 0.037 → 0.027 → **0.029** *(uninterpretable — partial policy)* | 0.857 → 0.786 → **0.857** |
| `cc-mimo` | 117 → 113 → **116** | 0.0636 → 0.0660 → **0.0642** | unchanged, 0.143 |

Read the first column: on ABCD, τ² and `cc-mimo` the corrected test suppresses one rule between them, and rev. 11's apparent precision gains on ABCD and τ² are gone with the rules that caused them — those two corpora never had a vacuous contact rule, and the "precision rises, recall unmoved" result was the bug, not the fix. On `cc` it still suppresses 648, which is the finding FS §10.5 reported, and recall returns to 0.857: the written clause rev. 11 booked as the cost of the fix was never a cost. The claim this pattern can now make is narrower and true — the test fires where a contact is not a unit of work, and nowhere else.

Rev. 11's ordering — `vacuousWhen: 'survivor'` — stands unchanged and is now under test. `test/fixtures/window/` is a second oracle: ten contacts, two episodes each, where one guard always precedes the subject (suppressed, uninformative) and one precedes it in seven of ten and follows it in three (proposed, with its three counter-examples). Under rev. 11's window the second is indistinguishable from the first, so the fixture fails against it. The synthetic oracle could not have caught this: every `no-X-without-prior-Y` rule there is contradicted, subsumed or refused before the late loop runs, so the path never fires.

**rev. 11 — 3 Sep 2026. The interaction window, fixed (FS §10.5 closed).**

§7.2's `no-X-without-prior-Y` says *establish Y once per sitting, then X is allowed*. That is a rule only where a sitting might not contain Y at all. The pattern never tested it, and so it silently assumed a contact is a unit of work — true for ABCD (one subflow per conversation) and τ² (one scenario per simulation), false for `cc`, where a contact is a multi-hour session holding twenty tasks, every common step occurs in it somewhere, and *"at some point earlier in the contact you listed a directory"* came back at 324 of 324: a fact about the length of the sitting, not about anything the agent chose.

**The fix is a vacuity test, not a threshold.** The rule is suppressed when every contact that performed the subject already contained the guard — exactly the question `at-most-one`'s vacuity test asks, and it needs no floor, no tuning and no sweep. `Instance` gains `sessionAll` (the contact's events) to support it, in both extractors. What was considered and rejected: capping how many episodes a contact may have, and scaling the window by `expected_episodes`. Both are floors on the container, and the container is not the thing that is wrong — the missing premise test is.

**Ordering matters and cost one iteration to learn.** Applied where `at-most-one`'s vacuity is applied — before a rule is ever proposed — it broke the synthetic oracle: the planted credit ping-pong lost its contact-window half, so a planted contradiction went unreported, and the documented subsumption reason (§7.2, "the interaction-window twin of a proposed episode rule … *recorded as suppressed*") was overwritten with a weaker one. A relational verdict names another rule and is strictly more useful than "uninformative", and a contradicted rule must stay contradicted because F8.1's diff reports it. So `Pattern` gains `vacuousWhen: 'candidate' | 'survivor'`: `at-most-one` keeps the early test unchanged, and the contact window's runs last, over what still stands after contradictions and subsumption. The oracle then reproduces its planted answer key exactly.

**What moved, on every corpus:**

| corpus | proposed | precision (strict / lenient) | recall |
|---|---|---|---|
| synthetic (oracle) | unchanged | — | planted answer key reproduced exactly |
| ABCD | 150 → 149 | 0.529 → **0.535** / 0.575 → **0.581** | unchanged |
| τ² retail | 21 → 20 | 0.524 → **0.550** | unchanged |
| `cc` | 3,351 → **2,256** | 0.037 → 0.027 *(uninterpretable — partial policy)* | 0.857 → **0.786** |
| `cc-mimo` | 117 → 113 | 0.064 → 0.066 | unchanged |

The shape of that table is the argument. On the two corpora where a contact really is a unit of work the fix removes exactly one rule each and **precision rises with recall unmoved** — the rule it took was true and useless, which is what it was built to take. On the control corpus, where the assumption also held, it is a 3% no-op. On the corpus that exposed the problem it removes a third of the rule set.

**The cost, stated plainly: `cc` loses one written clause, 12 of 14 down to 11.** One rule polyx had been recovering was only ever recovered through the contact window, and it is now gone. That is the honest price of the change and it is not hidden in an average: a fix that improves two corpora and costs one clause on a third is a trade, not a free win. `cc`'s precision also falls, because its confirmed count falls faster than its proposed count — but that figure was already marked uninterpretable against a `partial: true` policy (rev. 10) and nothing here changes that.

**rev. 10 — 3 Sep 2026. A fourth corpus (§4.4), and a miner change tried, measured and rejected.**

§4.4 adds the `cc` adapter: Claude Code transcripts, the first corpus in which the agent under study is an AI agent taking consequential actions against real systems. 141 sessions, 34 projects as operators, 7 models as agents, 102,927 events, 1.4% unknown. The mapping is τ²'s with one difference that carries the whole adapter: **a shell command is not one action.** 63% of the tool calls are Bash, so typing the call `action:Bash` would place `ls` and `git push --force` in one event type; the command is split on `&&`, `||`, `;` and newlines — never on `|` — and `git status && git add -A && git commit` yields the three decisions it is. A heredoc truncates the parse because its body is data. Free text is never persisted: the verb survives as a feature and the file path as a redaction *token* rather than a hash, because a per-file obligation needs a joinable binding.

**§10 gains a segmentation data point it has been missing since Phase 1.** Every record carries the `promptId` it was produced under, so `expected_episodes` is a real per-session task count. The null segmenter agrees with it on 42.6% of sessions; the intent-boundary segmenter agrees on 67.4% and yields 3,000 episodes over 141 sessions. On ABCD the same segmenter scored 13.2%. FS §10.4 asked whether the boundary segmenter transfers to dialogue and could not answer it for contacts holding several tasks, because no corpus polyx had shipped ground truth for that case. The answer is that the segmenter is right where a contact holds many tasks and wrong where it holds one — so §2's segmenter becomes a property of the **corpus** rather than of the installation (`CorpusConfig.segmenter`; `--segmenter` still overrides, which keeps the comparison one command).

**§7.2 — the ambient-guard filter, rejected.** The first rules mined on `cc` were *"before you run a script, change directory"* (324/324) and *"before you write a file whole, echo something"*: true, never violated, unactionable. A filter was built to withhold any guard qualifying for ≥90% of the corpus's subjects, on the reasoning — borrowed from the data-condition rule that a condition must discriminate — that a guard discriminating between no subjects is background. It was implemented, run on `cc`, and reverted, for two measured reasons. It withheld `read_file` and `git_inspect`, which are the two guards this corpus most needs and the two its written rules actually name, because in a session holding twenty tasks over several hours a genuinely important guard is ubiquitous too; splitting the measurement per window did not save it, since even inside one episode nearly everything precedes everything here. And it *raised* the proposed count, 3,400 → 4,447, because dropping the top-ranked guard only frees its slot for a worse one. **Ubiquity does not separate a norm from noise.** Recorded rather than deleted, because the next person to look at this rule set will have the same idea.

**What fixed it was the alphabet, which is where §7 says to look first.** The pattern table has always required a guard to be a step (`kind: action`). v1 of `alphabet.cc.yaml` typed everything the agent ran as an action, so `cd`, `export`, `echo`, `sleep` and the agent's own to-do bookkeeping were eligible guards. None of them is a step: none can be deliberately done first and none is a thing a gate would usefully require. v2 types them `system` — the same treatment BPIC's scheduler transitions already get — moving ~19k of 64k action events out of the guard pool, and splits v1's single 19,544-event `shell_inspect` into listing, reading and searching. A guard type that fires in every episode cannot discriminate no matter what the miner does with it; that was the alphabet handing the miner a problem the alphabet had created.

**§9 gains a precondition it never had to state before: precision requires a policy that tries to be complete.** A clause set was decomposed for `cc` (`policies/cc-policy.yaml`, 24 clauses, 14 expressible) and produced recall 0.857 (12/14), adjacent-only 0.818, refusal correctness 0.988 — and precision **0.037**, tripping the harness's falsification line. That verdict is wrong, and the reason it is wrong is worth more than the number. Precision asks what share of proposed rules the policy contains. That is a question about the miner only when the policy is *complete over the actions it governs*: ABCD's guidelines cover every flow, τ²'s retail policy covers its domain, and a rule outside them is genuinely a rule the rulebook rejects. Claude Code's standing rules are a dozen guardrails over an unbounded action space and never claimed otherwise, so nearly every true regularity in the corpus falls outside them **by construction** — which is the diff's *tribal knowledge* region, not a false positive. Clause sets therefore carry `partial: true`, and against a partial policy recall and refusal correctness are reportable while precision is not. FS §6.1's claim presumes a policy that contains what it should; that presumption was invisible until a corpus arrived without it.

The confounder control has an unusual shape here and it favours the corpus: **14 of 14 expressible clauses were violated at least once**, so recall over the violated-only subset equals the headline. On τ² retail only 2 of 15 were ever violated and the controlled figure was 0/2. The agent held these rules in its prompt and broke every one of them, which is the condition under which recovering a rule from behaviour means something. The offsetting caveat is volume: 3,351 proposed rules across 34 operators make covering 14 clauses cheap, so 12/14 is a floor on reach rather than evidence of aim, and it stays that way until the interaction-window question below is settled and a gold alignment exists.

**Open, and deliberately not fixed here (FS §10.5).** The remaining top rules on `cc` are all interaction-window (`no-X-without-prior-Y`), and on this corpus that window is a multi-hour session holding twenty tasks — so "somewhere in the last four hours you ran `ls`" is not a precondition. The pattern assumes a contact is a unit of work, which holds for ABCD and τ² and does not hold here. `expected_episodes` already measures the difference. Not changed on the day the alphabet changed: two miner changes had already been proposed on this one corpus's evidence and one was reverted, and a third would be tuning to a corpus rather than fixing a spec.

**§4.4 gains a second, public corpus that isolates that variable — `cc-mimo`.** `choucsan/mimo-claude-code-traces-1k` (MIT, HuggingFace) is Claude Code JSONL, so the `cc` adapter reads it unchanged and `alphabet.cc.yaml` types it at 0.6% unknown: **859 sessions, 10 task categories as operators, one model, and exactly 1.00 episode per contact.** It differs from `cc` in the one respect that matters and is otherwise the same corpus shape, which is what a control is.

The result is decisive in both directions:

| | episodes / contact | null agreement | intent-boundary agreement | proposed rules | recommendations |
|---|---|---|---|---|---|
| ABCD | 1 | 100% (by construction) | 13.2% | 87 | 63 |
| **cc** (private) | 21.28 | 42.6% | 67.4% | 3,351 over 34 operators | **0** |
| **cc-mimo** (public) | 1.00 | **100%** | **100%** | **117 over 10 operators** | 7 |

Where a contact is a task, both segmenters agree perfectly, the interaction and episode windows coincide, and the rule set is small and readable — *"before you run a script, write a file whole"* at 231/243, with the twelve counter-examples that make it a rule someone could break. Where a contact is twenty tasks, the interaction window degenerates and the count explodes. **So the pattern table is not wrong; its window assumption is, and the assumption is measurable per corpus rather than arguable.** That is the second corpus's evidence FS §10.5 wanted before the window is touched, and it is public, MIT and reproducible by a reader, which no figure from `cc` can be.

`cc-mimo` is the weaker *evaluation* corpus for the opposite reason: against `policies/cc-policy.yaml` it exercises only 4 of the 14 expressible clauses (recall 0.143 headline, **0.500 over the violated-at-least-once subset**, refusal correctness 0.878), because short single-task sessions never touch git, publishing or the browser. The two corpora are complements — one mines well and evaluates thinly, the other the reverse — and that is worth more than either alone.

**On the `agent-traces` tag as a source, since the survey pointed at it.** HuggingFace now carries 495 datasets under it and a published session format (`type: session` header, then messages with `toolCalls[].function.{name, arguments}`). Most of them, including the most-downloaded, are prompt→text with **no tool call in the file** — the tag marks a viewer, not agency. It is a discovery surface, and the reader that would consume the published format is not written here because the corpus that justified it turned out to be in Claude Code's own shape already.

**rev. 9 — 1 Sep 2026, from the code review of rev. 8.** Seven findings, all
fixed. Three were violations of the very spec rev. 8 adopted, which is the
useful lesson: adopting a specification means reading its consumer-behaviour
section, not only its data model.

- §5.1 — **a capability was removed under cover of an encoding change.** The
  rev. 8 parser hard-coded non-`action` kinds to `consequence: none` and
  refused them from declaring otherwise. The pair it replaced had no kind
  restriction, so a `system` event that moves money — a disbursement the
  environment records rather than the agent — was a legal mining subject and
  silently stopped being one, with **no expressible migration**: the old form
  failed with a message telling the author to write `consequence:`, and doing
  so failed again. Any kind may now declare a consequence; `kind: action` must.
- §8 — **the advisor did not enforce `recommendable`** (ACV §8.3, a MUST). The
  gate was mine-time only and the advisor works off stored rules, so setting an
  action non-recommendable left already-adjudicated rules being served until
  someone happened to re-mine. `Advisor` now takes the recommendable set and
  withholds, counting what it withheld: the alphabet, not the stored verdict,
  is the authority, so a policy decision takes effect on restart. A withheld
  rule is dropped rather than thrown — an unevaluable pattern is a defect in
  polyx, but this is a legitimate decision that must not take the service down.
- §7.3 — **the mine-time gate left no record.** Every other suppression in the
  miner reports one; this dropped candidates silently, and because the
  antecedent is still marked explained the node is not extended either, so a
  deeper rule for a different action is lost too. That cost is real, so it is
  now counted per action and printed. Reported, not hidden.
- §8.4 — **the audit failed open on unknown terms.** `consequence ?? 'none'`
  reported every event the alphabet could not classify as costless and
  proposable; ACV §8.4 requires `irreversible` / `recommendable: false` and
  explicitly forbids treating an undeclared term as `none`. The one place in
  rev. 8 that degraded toward permission, in the commit that adopted the rule
  against it.
- §7.2 — **the mining floor now defaults to `compensable`** (ACV §8.2), which
  is `MINING_FLOOR` and a parameter of `consequentialTypes`. Latent: nothing
  declares `reversible` yet. It becomes a CLI threshold the day an alphabet
  does, which is the first day the choice can move a figure.
- F3.2 in the functional spec **was left normatively false** by rev. 8 — it
  still required `reversibility`, which the parser refuses, so anyone
  implementing to the requirement wrote a document that could not load. Rewritten,
  with the superseded text kept, and F3.4 added for `recommendable`.
- **The gate was untestable by construction.** `recommendable: false` appeared
  nowhere in the repo, so deleting the gate entirely left every test green, and
  two comments claimed a coverage that did not exist. Three tests now exercise
  the closed state — selector, miner and advisor — and the deletion the review
  described now fails one. A safety gate whose closed state is never exercised
  is a gate that can silently regress.
- The crippled-alphabet fixture in `test/audit.test.ts` collided with the real
  synthetic alphabet's new version; bumped to v3, restoring F2.2's property
  that two audits under different alphabets are distinguishable from their
  stamps alone.

No mined figure moved: `reproduce.mjs` reports every committed figure
reproduced, and the test count went 92 → 96.

**rev. 8 — 29 Aug 2026. ACV 1.0 adopted for the declaration half of the alphabet.**

The alphabet was doing two jobs in one file: **classification** (`match:` —
which raw rows become which type, private, derived from data nobody can share)
and **declaration** (what an action costs and who may propose it). The second
is ACV (`docs/acv-1.0-spec.md`), almost exactly. Separating them is what makes
expertise shareable inside a bounded system at all: a vendor ships the
declaration for their own API surface, which is canonical by definition, and
each customer keeps their own match rules. Nothing private crosses.

- §5.1 — **`consequential: boolean` + `reversibility` became ACV's single
  `consequence` ordinal** (`none | reversible | compensable | irreversible`,
  ACV §6.3). The pair was redundant and could express
  `consequential: true, reversibility: free` — a type that was legal to write
  and silently discarded, and the synthetic alphabet contained one. The
  ordinal also adds the `reversible` tier the pair could not express. The old
  keys are **refused with a migration message**, never translated: a silent
  rewrite of a field every downstream figure depends on is the change nobody
  notices. Subjects are now `consequence !== 'none'`, which is the same set.
- §7.3 — **`recommendable` (ACV §6.4) gates recommendation mining.** Required
  in the document on every irreversible action — the author must decide
  exactly where a wrong default is unbounded — and defaults true below that.
  polyx previously had no such gate at all: the recommendation miner ran over
  every subject, so it would happily propose an irreversible action, and on
  ABCD it did (`manage_create → make a purchase`, 75/79). The gate is applied
  where a candidate is **emitted**, not where the search explores, so the
  search shape is identical whether or not an action is recommendable — a
  non-recommendable action still explains its decision points and must still
  be the baseline a longer antecedent has to beat.
- All four alphabets bumped to **v2**. This is a change of encoding only: no
  event moved between types, every declaration is behaviour-preserving, and
  the reproduction confirms **no mined figure moved**. The version bumped
  because the file did (F2.2).
- Every irreversible action is declared `recommendable: true`, which preserves
  current behaviour and is recorded in each alphabet as a *declaration, not a
  reviewed operational policy*. BPIC 2017 is where this most needs a domain
  reviewer: `A_Denied` and `O_Accepted` are the two a lender would most
  plausibly set false — proposing a denial is an underwriting decision, and
  accepting an offer is the applicant's act. Not changed here; guessing a
  lending policy is not the miner's business, and the gate now exists to carry
  the answer when someone qualified gives it.
- §7.4 — **warrant recorded as a second axis**, not a fifth level on the
  evidence lattice. Design only; not built.

**Separately, and not caused by the above:** three `abcd.coverageCeiling`
figures in `docs/results.json` were stale. The file was written at 16:24 on
29 Aug; the F5.4 review sitting ran 16:32–16:38 and adjudicated one
recommendation `not_real` (`intent = cost AND shipping_option = out for
delivery → offer a refund`, 47/47). `--assume-proposed` treats every *proposed*
rule as real but correctly excludes an adjudicated `not_real` one, so agreement
and outcome-precision fell slightly and `cleared` rose from 0.5% to 1.4%. The
numbers moved because a human made a judgement, which is the system working;
the file simply had not been regenerated since. Verified by reproducing on the
committed code with the ACV changes stashed — the same three figures moved and
nothing else did.

**rev. 7 — 29 Aug 2026, from the reviewer session.** Two defects in the recommendation family, both found by a human reading one rule on the review surface and saying it did not make sense.

- §7.3 — **redundancy pruning for recommendations.** The subset check compares an antecedent only with its own subsets, so it could not see that a rule was a worse-stated proxy for a *different* rule already emitted. On ABCD `payment_method = paypal AND membership_level = gold → update the order` (38/38) stood beside `episode.intent = return_color → update the order` (132/147) with 34 of its 38 instances inside the return flows the second already answered — and it claimed to hold whenever gold and paypal, though every instance supporting it was a return or refund. Rules for one action are now taken broadest-first and kept only when enough of what they explain is new. The distinction that matters: a rule nested inside **one** broader rule and materially more accurate is a *refinement* and is kept; one smeared across **several** is a *proxy* for what they share and is suppressed. ABCD: 6 refinements against 81 proxies; 162 recommendations → 81.
- §7.3 — **the instance floor scales with antecedent length** (`antecedentFloorExponent`, default 1, so the floor is `minInstances × conditions`). A conjunction search tries thousands of candidates and some hit a perfect run by luck: every one of ABCD's twelve three-condition rules rested on fewer than fifteen instances, several on exactly five, two conditioned on a US state. A longer antecedent is a stronger claim drawn from a larger search and is paid for with more evidence. Swept and reported, never tuned: exponent 0 / 0.5 / 1 / 1.5 gives 81 / 67 / 63 / 60 rules, and the one-condition flow rules are unaffected at every setting.
- §8 (review surface) — a recommendation was being shown an obligation's evidence: a guard highlight where there is no guard, and a counter-example panel that says nothing about it. It now shows **lift** — how often the action is taken across all decision points against how often under the rule's conditions — plus what else the agents did in those situations and how they ended. A rule whose base rate is already ≥90% says so outright. Chat turns collapse to a count, so the events that matter are visible.

**rev. 6 — 29 Aug 2026, answer-key review.**

- §9.1 — a clause set may mark each precedence clause `adjacent`, meaning the policy lists the two actions consecutively. Subflows whose text frees the order of actions contribute no expressible clause, with the quote recorded as the `reason`. ABCD: 499 clauses, 155 expressible, 48 of those adjacent.
- §9.3 — recall is reported over four denominators, none of them "the" recall: all expressible clauses (the product claim), adjacent-only, violated-at-least-once (the τ² confounder control), and the clauses the corpus itself keeps (a diagnostic separating a miner miss from a compliance gap). The last is computed at the `ownSupport` floor and is explicitly not a headline, because shrinking a denominator until the number looks good is the failure the harness exists to prevent.

**rev. 5 — 29 Aug 2026, after Phase 6 and the Phase 0 review.**

- §4.3 — BPIC as built: streamed XES, one line, cut at `</trace>`; the case's most frequent `org:resource` is its agent; trace attributes are facts; workflow transitions other than start/complete are `system`; the terminal `A_*` state is the outcome with a real `lagMs`.
- §5.3 — pattern rules apply only to values no slot rule touched (surrogates are hex; a `digits` rule would mangle them); `null` passes through, never a surrogate.
- §7.5 — identity ordering is code-unit (`src/order.ts`), never locale collation; this applies to every persisted sort.
- §10 — the diff as built, including the three-way split of the compliance gap and the *awaiting alignment* region for matches the structural matcher could only propose.
- §11 — `corpusRevision` hashes paths relative to the source; the manifest stamps the alphabet file that actually typed the run; `scripts/reproduce.mjs` is the reproduction pass and `docs/results.json` the committed figures.
- §7.6 — the rule row key is (identity, corpus, scope): τ² retail under four backbones is four corpora sharing the operator name `tau2:retail`, and their rows must not overwrite each other. Found when the reproduction pass reported a 1% coverage ceiling for a corpus that reaches 100% in isolation.
- §8.1 — condition equality is by string form (`eq`/`neq`); facts arrive typed differently from different adapters and reviewers type strings. The advisor refuses at load any real rule whose pattern it has no check for.
- §7.2 — a contradiction is recorded with the operator whose proposed set holds both rules.
- §2 — Node ≥ 22.18 (type stripping unflagged). `bin/polyx.mjs` sets `exitCode` rather than calling `exit()` so a piped `--json` report drains.

**rev. 4 — 29 Aug 2026, after Phase 5.**

- §7.3 — recommendations as built: one decision point per episode (the first consequential action and the fact base before it); breadth-first antecedent search up to `antecedentMaxLength`, the shortest sufficient antecedent wins, a longer one is kept only when it beats every shorter subset by `recommendGain`; proposed at `recommendAgreement` (0.8) with `minInstances`; `outcomeSupport` carries the second figure. Recommendations are never evaluated against a policy — `polyx evaluate` is obligations only; `polyx coverage` measures agreement and outcome precision.
- §8.2 — a fourth verdict, `clear`: every real obligation on the considered action holds and nothing is recommended. It is an answer and counts as covered. The response also carries `cleared: [...]`. Without `considering`, only recommendations answer.
- §8.3 — decision points are logged to `decision_points` with their source (`serve:<corpus>` live, `replay:<corpus>` from `polyx coverage`); `GET /coverage` summarises the live log.
- §9.3 — coverage, agreement, outcome precision, warned/cleared shares and inference displaced come from `polyx coverage <corpus>`; `--assume-proposed` is the labelled what-if ceiling.

**rev. 3 — 29 Aug 2026, after Phases 3–4.**

- §4.2 — τ²-bench is not generated here: the benchmark ships trajectories under four backbones with seeds and commit; the adapter reads one results file (one backbone × one domain) or a directory of them, ids carrying the backbone when pooled. The backbone is the actor's *team*; `--scope-by backbone` makes it the operator for the cross-backbone experiment. Tool calls → `action` (one per call, arguments as slots, all hashed); tool messages → `system` with `result` from the error flag; the verifier's reward labels the outcome only.
- §5.1 — an alphabet's `corpus` may be a family name shared by several configured corpora (`tau2-retail` for one corpus per backbone).
- §9.1 — clause shape `at-most-one` added beside `precedence`; the ABCD clause set is a mechanical decomposition of `kb.json` + `guidelines.json` (499 clauses, 173 expressible), the τ² retail set a hand decomposition (27 clauses, 15 expressible). Inexpressible clauses carry a `reason`, reported by count.
- §9.2 — the matcher is structural and deterministic (exact / general / proposed); an unconditioned rule stated in every scope of its subject is *exact*. No LLM matcher was built; the gold file format and the matcher-vs-gold and inter-rater figures exist and report "none" until a person rates pairs.
- §9.3 — every figure is reported strict and lenient, plus precision over alignable shapes; a refusal is incorrect only against an *exact* clause; recall is reported a second time over the clauses violated at least once (control 1) and the failed share is printed (control 2). `--sweep` reports the grid.
- §11 — the first honest sensitivity result: on ABCD the instance floor is the lever (5 → 30 moves precision 0.575 → 0.770 at recall −0.006). The default stays; a corpus-relative floor is an open question.

**rev. 2 — 29 Aug 2026, after Phase 2.** Marked "(rev. 2)" in place:

- §3 — `Interaction.facts`: customer/account state known at the start of the contact (what the agent had on screen), redacted like slots. It is the fact base data conditions are mined over and the advisor is queried with. ABCD's scenario `personal` / `order` fields supply it.
- §7.1 — three more statuses; `corpusSupport`; `scope`; the row key is (id, scope).
- §7.2 — subsumption as built; vacuous rules; discriminating conditions; candidates scored at every operator.
- §7.4 — the lattice is read broadest-first; the verdict names the broadest level with own evidence.
- §7.6 — lifecycle as built, including what is recomputed and what is the human's.
- §8 (forward) — the review surface is a local `node:http` page (`polyx review <corpus> serve`), one rule per screen, verdicts written to the store as given; the CLI is the analyst's tool. Pace (F5.4) is the median gap between consecutive verdicts by one reviewer, measured from the adjudication timestamps — not yet measured on a real reviewer.

**rev. 1 — 29 Aug 2026, after Phases 0–1.** Changes forced by building against the real corpora, each marked "(rev. 1)" in place:

- §3 — added `customer_utterance` to `EventKind`. ABCD classifies no customer turn; a dialogue corpus needs an unclassified customer kind or every customer turn is falsely an intent.
- §4.1 — ABCD mapping corrected: per-turn intent targets do not exist, the scenario subflow stands in for the first turn's intent; `delexed` is only partly delexicalised; no agent ids, no timestamps; one subflow per conversation, so segmentation ground truth is one episode.
- §5.1 — event type ids may carry `${feature}` placeholders (`intent:${intent}`), materialised per event; an empty placeholder yields `unknown`.
- §5.3 — redaction gained the `'*'` wildcard with `except`, value-pattern rules, and per-slot allowlists (`unless`, `unless_pattern`).
- §6 — `Segmenter.segment` takes a context and may be async; ids are local and composed by the pipeline. `NullSegmenter` is the correct segmenter for ABCD by construction; the polyness adapter (new episode at every classified intent) scores 13.2% agreement on ABCD because greetings before the first intent form their own episode — reported, not hidden.
- §13 — week 1 built a synthetic oracle corpus with a planted rule set instead of the ADP adapter (see the implementation plan §0); ADP is deferred to Phase 4 as opportunistic.
- Dependency — polyness is linked as `file:../polyness` for the MVP. Vendoring the three modules actually used (episodes, subjects, provenance) is the Phase 6 packaging decision; the `polyflow` tarball transitive is the reason.
