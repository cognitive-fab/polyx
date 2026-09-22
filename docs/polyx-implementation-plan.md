# polyx — Phased Implementation Plan (MVP)

**Status:** phases 0–6 complete 29 August 2026; post-MVP addendum §6a, 3 September 2026
**Companion to:** polyx Functional Specification (MVP), polyx Technical Specification (MVP)
**Capacity:** one engineer with agent assistance · 12 weeks · start Mon 31 Aug 2026
**Confidentiality:** commercial. Private polyx repository only.

---

## 0. How to read this plan

The specs contain a week-by-week table (FS §9, TS §13). This document turns that table into an executable plan: it groups the weeks into six phases with hard exit gates, names the artefact that ends each phase, pulls forward the items with external lead time, and states what happens at the week-6 go/no-go rather than assuming it passes.

Three principles govern the sequencing.

**The claim is the deliverable.** FS §6.1 — *polyx recovers a known policy and correctly declines to propose what the policy does not contain* — is the only thing the MVP must prove. Every phase before the gate exists to make that measurable; every phase after it exists only if the number survives. Work that does not move the gate closer is deferred past it, on purpose.

**Structural correctness before figures.** The answer-key boundary (TS §14), redaction (F1.3), determinism (TS §11) and rule identity (TS §7.5) are properties that are cheap to build in week 1 and effectively unrecoverable if retrofitted in week 8 — a leaked guideline file invalidates every number produced before it is found. These land in Phase 0 as tests, not as intentions.

**Anything with a person or a licence in the loop starts on day one.** A gold alignment needs a second rater. F5.4's 90-second target needs a real domain reviewer, timed. BPIC needs its terms read; CRMArena-Pro needs a reply from Salesforce. None of these are engineering work and all of them have weeks of latency. They run on a parallel track from week 1 (§8).

### Deviations from the spec's week table, and why

| Spec | This plan | Rationale |
|---|---|---|
| W1 ADP adapter first | W1 **synthetic fixture corpus** first; ADP deferred to Phase 4 as opportunistic | The first adapter's job is to unblock the alphabet, miner and store. A hand-built corpus with a known planted rule set does that on day one, gives the determinism and provenance tests their ground truth, and cannot slip on corpus parsing. ADP (F1.4, `SHOULD`) buys breadth the MVP claim does not need. |
| W5 policy clause set + alignment | Clause decomposition **starts W2**, runs in background | It is hand work with a human dependency and it sits on the critical path to the gate. Starting it the week ABCD parses removes the single most likely cause of the gate slipping. |
| W4 "review CLI" | Review CLI W4; **HTML review surface W5** | FS §2 says the domain reviewer never uses a terminal, and F5.4 requires a median-90s measurement *on a real reviewer*. A CLI cannot satisfy either. The CLI is the analyst's tool; the reviewer needs a page. |
| W11 BPIC | BPIC **conditional**, decided at the Phase 4 exit | It contributes realism, not a number (FS §6.3). It is the correct thing to cut if any earlier phase overruns, and deciding that in week 8 rather than week 11 protects the diff. |

---

## Phase 0 — Foundations and the traps (Week 1 · 31 Aug – 4 Sep)

**Goal:** a repository in which it is structurally hard to produce a dishonest number.

### Build

1. **Repo skeleton.** Node 22 LTS, ESM, TypeScript, no bundler, no framework. Directory layout exactly as TS §2. `corpora/` gitignored with fetch scripts only.
2. **Canonical record** (TS §3) as types plus a runtime validator: `Interaction`, `Event`, `EventKind` including `unknown`, `Outcome` with `lagMs`, `RawRef`. The validator is the thing every adapter's fixture test asserts against.
3. **SQLite schema and migrations** (TS §2): rules, adjudications, evidence pointers, run manifests. Derived artefacts only — corpora stay on disk.
4. **Run manifest** written by every command: corpus revision, alphabet version, thresholds, seed, code commit, backbone where applicable (TS §11). Nothing prints a figure without stamping one.
5. **CLI skeleton**: `polyx audit | mine | review | serve | evaluate | diff`, all wired, most stubbed.
6. **Synthetic fixture corpus** — ~40 hand-authored interactions across two operators and three agents, with a *known* planted rule set: two obligations that hold, one that holds only for one operator (provenance ground truth), one mutually exclusive pair (contradiction ground truth), seeded account numbers / emails / phone numbers (redaction ground truth), and a deliberate unknown-event tail. This corpus is the test oracle for the next eleven weeks.
7. **The four structural tests**, green before any mining exists:
   - **Boundary check** (TS §12) — a static import check asserting no module under `mine/` reaches `evaluate/policies` or any guidelines file. Wired into CI on day one, because it is worthless discovered late.
   - **Redaction scan** (F1.3) — the seeded identifiers, scanned in the SQLite file itself, zero hits.
   - **Determinism** (TS §11) — mine twice, byte-diff. Trivially green now; catches the day it stops being.
   - **Identity stability** (F4.3) — re-mine unchanged, ids identical; add one interaction, ids identical and support moved.
8. **`DATASETS.md` and `NOTICE`** created and CI-checked. Empty registers that exist are worth more than complete ones written in week 12.

### Exit criteria

- `polyx audit` runs end to end on the synthetic corpus and emits a manifest.
- All four structural tests green in CI.
- Parallel-track (§8) items 1–4 and 7 dispatched.

### Deferred out

Any real corpus. Any rule pattern. The port interfaces arrive with their second implementation in Phase 1, not before — a port defined without a consumer is guesswork.

---

## Phase 1 — Corpus in, alphabet, audit (Weeks 2–3 · 7–18 Sep) → **surface S1**

**Goal:** the analyst points polyx at ABCD and learns what the corpus does and does not support.

### Week 2 — ABCD and the alphabet

1. **ABCD adapter** (TS §4.1). `delexed`, never `original`. `convo_id` → `Interaction`; speaker `action` → `action` events typed from the button label with slots from the value-filling target; `scenario.subflow` retained as the episode seed. Fixture test on ≥3 hand-checked conversations, field by field (F1.1).
2. **`guidelines.json` behind the wall.** It lands under `evaluate/policies/` on arrival and never anywhere else. The boundary test from Phase 0 now has something real to guard.
3. **Alphabet subsystem** (TS §5): `alphabets/alphabet.abcd.yaml` as a committed, versioned, hand-reviewed artefact; the matcher that applies it; `polyx alphabet show <type>` resolving any event type back to its source records (F2.3); version stamped on every derived figure (F2.2).
4. **Redaction at ingestion** (F1.3, TS §5.3) — `token` and `hash` strategies on the slot map, applied before persistence. Free text never persisted; `RawRef` pointers only.
5. **Consequential-action config** (F3.1, F3.2) as reviewable per-domain data with declared reversibility. Free actions excluded from mining.

### Week 3 — episodes and the audit report

6. **Segmentation and subject ports** (TS §6) with **two implementations from day one**: the polyness adapter, and `NullSegmenter` plus a naive in-house extractor. A port with one implementation is a wish; the null path is also the fallback if polyness's dev-tool assumptions do not transfer to dialogue.
7. **Episode quality figure** (F3.3): episodes per interaction, share of episodes with zero consequential actions — and, because ABCD's subflow labels are ground truth for exactly this, segmentation accuracy scored against them. This is the cheapest available answer to open question FS §10.4, and it costs an afternoon here versus a re-derivation of every window later.
8. **`polyx audit`** on ABCD: interaction and episode counts, recurring actions, which are consequential, which clear the instance floor, the unknown-event rate, the alphabet version. It **says nothing when there is nothing to say, in those words** (FS §S1), and refuses to emit proposals above the 20% unknown gate (F1.2).
9. Every audit figure expands to records in one command (TS §1.3).

### Exit criteria

- Audit runs on full ABCD; unknown rate reported and below the gate, or the reason it is not is understood.
- Redaction scan green against ABCD-derived artefacts.
- Alphabet round-trips: every event type resolves to its source records.
- Episode segmentation quality reported against subflow ground truth.
- Both segmenter implementations produce episodes; the quality figure is reported for each.

### Risk to watch

If the unknown rate on ABCD sits above 20%, the alphabet is wrong — not the gate. Budget the fix here rather than lowering the threshold: every downstream number inherits this.

---

## Phase 2 — Mining and adjudication (Weeks 4–5 · 21 Sep – 2 Oct) → **surface S2**

**Goal:** candidate obligation rules with evidence, counter-evidence and provenance, reviewable by a person who is not the engineer.

### Week 4 — obligations, provenance, review CLI

1. **The four obligation patterns** in DECLARE terms (TS §7.2) with their windows, extended with **data conditions** on customer state (F4.1) — `precedence(disclose, quote) where product.type = 'mortgage'`.
2. **Support measurement** as `holds/of`, with **counterexamples always non-empty when `of > holds`** (F4.3, F5.1). A rule presented without its counter-examples is a defect, so the store makes that state unrepresentable rather than merely discouraged.
3. **Redundancy pruning by subsumption** (TS §7.2) — required, not optional. A rule implied by another proposed rule is suppressed and *recorded as suppressed*. Declarative discovery emits hundreds of true, useless constraints; without this the review surface is unusable and precision is meaningless.
4. **Provenance lattice** (F4.5, TS §7.4) behind its port: agent → team → operator → borrowed → neither, the verdict naming the level at which evidence was found. **No own evidence at any level ⇒ never proposed** (F4.4), while remaining scoreable on request.
5. **Contradiction detection** (F4.6) — the seeded mutually exclusive pair from the synthetic corpus is reported, not proposed.
6. **Rule identity** (TS §7.5) = hash of family, pattern, canonicalised bindings and conditions, window — deliberately excluding support. **Adjudication store** keyed on it (F5.2), with the `not_real` re-proposal rule and its δ threshold, and the reason for re-proposal surfaced (F5.3).
7. **`polyx review`** CLI for the analyst.

### Week 5 — the reviewer's surface

8. **HTML review surface** — one rule per screen, no navigation away (F5.4): the rule in domain vocabulary, support as a fraction, supporting interactions, **contradicting interactions**, provenance verdict, three buttons and a note field. Static HTML over the SQLite store; this is not an application.
9. **Rule lifecycle** (TS §7.6) complete, including automatic `retired` when support drops below the floor, always with the reason recorded.
10. **Timed review session** with the recruited domain reviewer (§8) on ~25 real ABCD candidates. Report the median. F5.4's target is 90 seconds, and the requirement is that it is *measured*, not that it is met.

### Exit criteria

- Candidate obligation rules on ABCD, each with support, counter-examples, provenance verdict and stable identity.
- Suppression count reported alongside the proposal count — if pruning removes less than expected, the pattern table is over-generating and precision will show it in Phase 3.
- Adjudications survive a re-mine.
- Median review time measured on a real reviewer, with the number reported whatever it is.

### Deferred out

Recommendation rules (Phase 5). They carry a different evidence standard and are the part most likely not to clear the floor; they must not delay the gate.

---

### Status — 29 Aug 2026

Phases 0–3 complete. ABCD mines in ~7s: 8 subjects, 87 proposed obligation rules (91 conditioned), 16 refused, 29 suppressed. Outstanding: the timed session with a real domain reviewer (parallel-track item 2); the human read of the ABCD clause decomposition and a gold alignment with a second rater (items 1, 5).

**Week-6 gate, first measurement (29 Aug 2026, commit `1ffdb76`, no gold):**

| figure | strict | lenient |
|---|---|---|
| precision | 0.529 (46/87) | 0.575 (50/87); 0.633 over alignable shapes |
| recall over 173 expressible clauses (of 499) | 0.474 | 0.497 |
| refusal correctness | 1.000 (16/16) | — |

Verdict: **BETWEEN** — above the falsification line (precision < 0.4), below the exit targets (p ≥ 0.7, r ≥ 0.5). Two findings from the diagnostic order in §7 before the number settled: (1) the first run was *falsified* at precision 0.306 because the condition search capped facts at 12 distinct values and `episode.intent` has 55, so no flow-scoped rule was ever emitted — a miner bug, not a finding; (2) alignment treated a global rule stated in every scope of its subject as merely "general" — a harness bug. Both fixed and re-measured. The remaining gap is real and named in the report: eight `at-most-one` rules the guidelines never state (true, useless to this policy), and unconditioned rules that hold at ≥ 0.9 across flows the policy scopes differently. The gate result stands as **proceed, carrying the number**; Phase 4's sensitivity sweep is spent on understanding it.

## Phase 3 — The gate (Week 6 · 5–9 Oct) → **GO / NO-GO**

**Goal:** the falsifiable claim, with a number attached, reproducible. Everything after this phase is conditional on it.

The clause decomposition and gold alignment started in week 2 (§8) and must be complete entering this week. If they are not, this phase slips and so does everything after it — which is exactly why they start early.

### Build

1. **Policy clause set** for the ABCD guidelines under `policies/` (TS §9.1): atomic clauses, each with `expressible`, `shape`, `subject`, `guard`. **`expressible` is load-bearing** — recall is reported over expressible clauses only, with the inexpressible count reported beside it, because "recovered 60% of the policy" and "recovered 60% of the third it can represent" are different claims and only the second is honest.
2. **Alignment** (TS §9.2): an LLM-assisted matcher *proposes*; a human *confirms*; a gold alignment on ≥100 pairs with inter-rater agreement reported; headline figures computed against gold, and the matcher's own agreement with gold reported separately as a named source of error. Alignment is never a determination (F8.3).
3. **Metrics** (TS §9.3): precision, recall, refusal correctness — each emitted with alphabet version, corpus revision, thresholds and seed. A metric without that stamp does not leave the machine.
4. **Reproduction test**: the full evaluation re-runs from a manifest and produces identical figures.

### The gate

MVP-exit targets (FS §6.1): **precision ≥ 0.70 · recall ≥ 0.50 on expressible clauses · refusal correctness ≥ 0.80.**
Falsification range (FS §6.5): **precision < ~0.4, or refusal correctness at chance.**

| Outcome | Action |
|---|---|
| At or near target | Proceed to Phase 4 as planned. |
| Between falsification and target | Proceed, but carry the number honestly into every later figure, and spend the Phase 4 sensitivity sweep on understanding it rather than on breadth. |
| **In the falsification range** | **Stop. Do not build the advisor.** Return to the pattern table and the alphabet (§7). Phases 4–6 are suspended, not rescheduled. |
| Inter-rater agreement poor | The headline number is measuring the matcher, not the miner. Fix the clause decomposition before reporting anything. This is a gate on the gate. |

### Exit criteria

- Three headline figures, stamped, reproducible from a manifest.
- Gold alignment ≥100 pairs with inter-rater agreement reported.
- An explicit, written go/no-go decision against the FS §6.5 thresholds.

---

## Phase 4 — Generalisation and sensitivity (Weeks 7–8 · 12–23 Oct)

**Goal:** find out whether the week-6 number is a property of polyx or a property of ABCD.

### Week 7 — τ²-bench

1. **Trajectory generation** against a **frozen backbone**, recording backbone, version, policy revision and seed in run metadata (TS §4.2). Trajectories under different backbones are different corpora and are never pooled silently.
2. **τ² adapter** — tool calls map to `action` events directly; the cheapest adapter in the system. Domains `retail` and `telecom`; `banking_knowledge` is retrieval-flavoured and treated as a stretch, not a primary.
3. **Policy clause sets** for the τ² domains, behind the same hard boundary as ABCD's guidelines.
4. **Both confounder controls, in the harness rather than the prose** (TS §9.4): recall reported a second time over the **violated-at-least-once** clause subset, and **failed and abandoned trajectories included** in the corpus. The τ² agent was handed its policy in the prompt; recall there is inflated, and an expert reader will find this in the first ten minutes if it is not already handled.

### Week 8 — provenance and thresholds

5. **Cross-domain provenance** (FS §6.4): mine in one τ² domain or one ABCD flow, score in the others; report where own, borrowed and no evidence land. This is the finding most likely to survive contact with a partner.
6. **Threshold sensitivity sweep** — every floor externalised and swept, reporting a curve rather than a tuned point (TS §11). The inherited floors came from one dev-tool corpus and are circular there; this is the first honest second domain, and tuning to a number here would repeat the error knowingly.
7. **Decision point:** BPIC in or out of Phase 6, on remaining schedule and whether its terms cleared (§8).
8. *Opportunistic:* the ADP generic reader (F1.4, `SHOULD`) if the week has room. Cut without hesitation.

### Exit criteria

- τ² figures reported with both confounder controls applied, and the two recall figures shown side by side.
- Cross-domain provenance results.
- Sensitivity curves for every floor; no floor reported as a single tuned value.
- BPIC go/no-go recorded.

---

### Status — Phase 4, 29 Aug 2026

**τ²-bench needed no generation.** The benchmark repository ships pre-generated trajectories (four backbones × retail/telecom/airline, gpt-4.1 user simulator, seeds and commit recorded), so the frozen-backbone corpus came for free and no API key was needed. Retail is ingested (456 simulations, 0 unknown events, 21.3% failed trajectories kept in); telecom is deferred — the retail policy alone already carries the finding below, and the adapter is domain-agnostic.

**The confounder, made visible (TS §9.4).** On τ² retail, headline recall is 0.733 (11/15 expressible clauses) — and only **2 of the 15 clauses were ever violated** by the prompted agent. Recall over the violated-at-least-once subset is **0/2**: the two clauses the agent actually broke (*modify items at most once*, *exchange at most once*) hold at ~0.88 in the corpus, below the 0.9 implication floor, so polyx did not propose them. The 0.733 is the agent reciting its prompt; the 0/2 is the number that means something, and it says the at-most-once floor is wrong for this corpus. Both figures are printed together, always.

**Cross-scope provenance (FS §6.4).** Across τ² backbones, nothing is borrowed and nothing refused: every backbone was handed the same policy, so own evidence exists everywhere — the experiment is uninformative there, by construction. Across ABCD *flows* it is informative: 218 proposed, 474 refused, and borrowed verdicts land exactly where a reader would expect — *manage_account* borrows "validate the purchase before offering a refund" from the three flows that keep it (2/18 locally), and refuses "verify identity before update account" where the guidelines never ask for it.

**Threshold sensitivity (FS §10.3), ABCD:**

| impliesSupport | minInstances | proposed | precision (lenient / strict) | recall |
|---|---|---|---|---|
| 0.9 | 5 | 87 | 0.575 / 0.529 | 0.497 |
| 0.9 | 10 | 75 | 0.667 / 0.613 | 0.497 |
| 0.9 | 30 | 61 | 0.770 / 0.705 | 0.491 |
| 0.8 | 30 | 54 | 0.815 / 0.741 | 0.491 |

The instance floor, not the implication floor, is the lever: rules on 5–29 instances are where the false positives live, and dropping them costs almost no recall. The default stays at 5 — the floors are reported, never tuned to a number — but a corpus-relative floor is now an open question for the spec, and at 30 the week-6 gate would read **TARGET** on precision. τ² retail is flat across the grid (0.50–0.52 / 0.73–0.80): with 456 near-identical trajectories the floors do not bite.

**BPIC decision (item 7):** deferred to the Phase 6 exit; the terms are still unread (DATASETS.md). ADP (item 8): not built.

## Phase 5 — Recommendations and the advisor (Weeks 9–10 · 26 Oct – 6 Nov) → **surface S3**

**Goal:** a live endpoint that recommends, warns, or abstains — and a caller that can tell the three apart trivially.

### Week 9 — recommendation rules, or the finding that there are none

1. **Antecedent search** (TS §7.3): conjunctions up to length 3 over conditions drawn from the alphabet's slot vocabulary, with a minimum instance floor. Bounded on purpose — beyond that the search explodes and the rules stop being readable, which defeats the point.
2. **Two figures, not one** (F4.2): **agreement** (the action taken matched) and **outcome-conditioned precision** (given it matched, how often the outcome was good). A rule that faithfully reproduces what agents do badly is caught only by the second.
3. **Planned negative result.** FS §10.2 anticipates that recommendations may be too sparse per segment to clear the floor. If they do not, that is a finding, reported as one, and the product becomes an obligation-warning service — smaller, still real. Do not lower the floor to manufacture recommendations; that trades the credibility of the whole §6 evaluation for a demo.

### Week 10 — the advisor

4. **Three-valued forward chaining over a fact base** (TS §8.1). Each condition is `true`, `false`, or `unknown`; **a fact absent from the request is `unknown`, never `false`**; any `false` means the rule does not apply; no `false` with at least one `unknown` means **abstain with `unknown_fact`, naming the fact**. Closed-world assumption is prohibited — "no record of income verification" is not "income was not verified", and in a bank that difference is the product.
5. **`POST /advise`** on `node:http` behind a thin router, contract exactly as TS §8.2. Serves **only** `status: 'real'` rules (F6.4). Abstention is a successful answer, not an error.
6. **Decision-point logging** — every response logged with its verdict. That log is the coverage measurement, and later the corpus for the next mining pass.
7. **Coverage metrics** (F7.1–F7.3): coverage, the uncovered : unknown_fact abstention split, agreement against actions actually taken, and inference displaced.
8. **Performance** (F6.5): 500 rules, p95 < 50ms, via an indexed scan over rules keyed by `bindings.subject` and by condition fact keys. RETE is not needed and would be premature.

### Exit criteria

- **The three-valued abstention test green** — remove a required fact, assert `abstain` rather than a changed recommendation (F6.3). TS §12 calls this the single most important test in the system; a failure here is release-blocking.
- Live `/advise` returning all three verdicts with evidence links.
- Coverage reported against the FS §6.5 floor: **coverage plateauing below ~10% of decision points is a falsification result**, not a tuning problem, and must be reported as one.
- p95 latency measured at 500 rules.

---

### Status — Phase 5, 29 Aug 2026

**Recommendations clear the floor on ABCD, not on τ².** One decision point per episode — what was known before the first consequential action, and that action. ABCD: 162 recommendation rules over 5,174 decision points at ≥ 0.8 agreement (breadth-first antecedent search, shortest sufficient antecedent wins; the first attempt emitted 1,017 and the second 612 before the pruning was right). τ² retail: none over 432 — the trajectories carry no customer facts and no classified intent, so nothing discriminates, and the advisor is an obligation-warning service there, exactly as FS §10.2 anticipated. The synthetic corpus plants the faithfully mined mistake: *complaint → offer a goodwill credit* is what was done 5/5 and ended badly 5/5, and only the second figure shows it.

**The advisor** (`polyx serve`, `POST /advise`) is three-valued: the F6.3 test — remove a fact, get `abstain(unknown_fact)` naming it, never a changed answer — is green, as is p95 < 50 ms at 500 rules. A fourth verdict was added (spec rev. 4): `clear`, when every real obligation on the considered action holds and nothing is recommended. That is an answer — "go ahead" — and counting it as abstention would have reported τ² retail's coverage as 4.6% when the advisor was in fact answering 99.1% of decision points.

**Coverage, as a what-if ceiling** (`polyx coverage <corpus> --assume-proposed` — every proposed rule treated as real; nobody has adjudicated yet):

| corpus | coverage | verdicts | agreement | outcome precision |
|---|---|---|---|---|
| ABCD | 94.2% (302 unknown-fact) | recommend 3,823 · warn 1,049 · abstain 302 | 92.1% | 88.6% |
| τ² retail | 99.1% (4 uncovered) | clear 408 · warn 20 · abstain 4 | n/a | n/a |

The served figure is 0% on both until a reviewer marks rules real — which is the product working as specified (F6.4), not a gap. Facts most often missing on ABCD: `slot.shipping_option`, `order.packaging`, `order.payment_method` — the list a caller should start sending.

## Phase 6 — Conformance diff, realism, packaging (Weeks 11–12 · 9–20 Nov) → **surface S4**

**Goal:** the report a domain reviewer will value first, and a repository someone else could run.

### Week 11 — BPIC (conditional) and the diff engine

1. **BPIC 2017 adapter**, if cleared at the Phase 4 decision (TS §4.3): XES cases → `Interaction`, `concept:name` through the alphabet, lifecycle transitions → `result`, terminal activity → outcome. **No dialogue and no agent** — `customer_intent` and `agent_utterance` are simply absent and the miner must not assume they exist. Contributes obligation mining at real institutional scale and the four-level provenance question; contributes **no precision/recall figure**, by design.
2. **Three-region diff** (F8.1, TS §10): mined ∧ ¬written → *tribal knowledge*; mined ∧ written → *confirmed*; ¬mined ∧ written → *compliance gap*, **with the explicit distinction between violated-in-corpus and never-exercised-in-corpus**. Conflating those turns "your reps ignore this rule" into "this situation never arose" — the difference between a finding and an embarrassment.
3. **Intra-set contradictions** reported separately (F8.1).

### Week 12 — the report and the close

4. **HTML report**, every finding linked to its interactions (F8.2), every alignment labelled proposed-for-confirmation (F8.3).
5. **Packaging**: `NOTICE` complete and CI-checked (Apache-2.0 attribution for polyness, licence text, modifications marked); `DATASETS.md` complete as a running register of what was used, under what terms, for what; the polyness transitive `polyflow` GitHub-tarball dependency reviewed, and vendored if that is the cleaner answer.
6. **Reproduction pass**: a clean checkout reproduces every headline figure from its manifest. If it does not, the figures are not results.
7. **MVP report**: the three headline figures, the τ² figures with controls, cross-domain provenance, coverage, sensitivity curves, and which of the FS §10 open questions this MVP answered and which it did not.

### Exit criteria

- Three-region report end to end on ABCD, with links to records.
- Every headline figure reproducible from a clean checkout.
- `NOTICE` and `DATASETS.md` complete and CI-enforced.

---

### Status — Phase 6, 29 Aug 2026

**The three-region report** (`polyx diff <corpus> [--out report.html]`) is built and, on the synthetic oracle, reproduces its planted answer key exactly: two rules followed but never written (tribal knowledge), the confirmed set, one clause written and violated 16 of 20 times, and the credit ping-pong as a contradiction. The compliance gap is split three ways — *violated* ("your reps ignore this"), *never exercised* ("this situation never arose"), and *kept but not mined* (followed every time, below a floor) — because conflating the first two is the difference between a finding and an embarrassment. Every finding names its interactions; every alignment is labelled proposed-for-confirmation. On ABCD: 36 followed-never-written, 50 confirmed, 75 written-and-violated, 10 kept-not-mined, 2 never exercised. On τ² retail the two violated clauses are exactly the two the confounder control found: *modify items at most once* (20 of 169) and *exchange at most once* (25 of 149).

**BPIC 2017 is in.** Its terms were read (4TU General Terms of Use; recorded in DATASETS.md with the DOI and citation) and the 578 MB single-line XES is streamed at `</trace>` boundaries with no XML library: 31,509 applications, 1.2M events, 141 resources as agents, real outcomes (17,228 accepted, 10,431 cancelled, 3,752 declined) arriving days after the case opened. Audit in 50 s, mine in ~3 min. It contributes what it was meant to: obligation mining against real institutional process at scale — *before you send the offer to the customer, accept the application* holds 41,733 of 41,733 times — and a recommendation with the second figure doing its work: *new credit → accept the application* is what was done 28,120 of 28,120 times and ended well 14,743 of 28,024. No policy document exists, so it contributes no precision figure, as planned.

**Packaging.** NOTICE and DATASETS.md are complete and CI-checked; the polyness dependency is **vendored** as of 8 Sep 2026 (`vendor/polyness/`, four modules, byte-identical, provenance in `VENDORED.md`), so a checkout no longer needs a sibling repository to install. That also decided the `polyflow` tarball question by removing it: none of the four modules the ports reach imports polyflow, so vendoring the closure dropped the dependency rather than carrying it. `scripts/reproduce.mjs` runs audit → mine → evaluate → coverage → diff for every corpus on the machine and diffs the figures against the committed `docs/results.json`; a clean checkout with the corpora fetched reproduces every headline number.

**Code review, Phase 0 (applied at Phase 6).** Nine findings, all fixed: locale-dependent `localeCompare` in rule identity and every persisted ordering (now code-unit `cmp`); the manifest stamping the configured alphabet rather than the one that produced the run; literal NUL bytes in the token separator making the redaction module a binary file; the corpus revision hashing absolute paths; pattern rules re-scrubbing surrogates and tokenising `null`; `engines` below the Node version that strips types unflagged; `fileURLToPath` in the CI scripts; `--threshold k=` silently setting a floor to zero; unmatched actions losing their speaker's kind. **Code review, Phases 1–6.** Ten findings, all fixed with regression tests: a free-text adjudication note beginning with `{` broke every later read of the table; a reviewer's `--condition order.num_products=1` never matched the string fact (equality is now by string form); the advisor's pattern chain had no else and would have *cleared* an obligation it never checked (it now refuses to load a rule it cannot evaluate); the recommendation pruning let a longer antecedent survive beside a better subset the search had skipped; contradictions lacked their operator; the reproduction script treated the gate's exit code 3 as a failure; a missing gzipped BPIC source crashed the process instead of rejecting; the persisted run manifest lacked the policy revision it claimed; unknown-typed customer turns could become intents and episode boundaries; and the identity-ordering change is noted as a store-rekeying event (no store predates it). Cut-list items applied too: `polyx` with no command exits 1 again, one definition of a good outcome, polyness loaded lazily so the CLI runs without the link, a typo in `--extractor` is an error, `instanceFacts` memoised, sweep mines obligations only, dead exports removed.

**Answer-key review (parallel-track item 5), 29 Aug 2026 — done.** The operator sampled the mechanical decomposition against the guideline text and ruled on two defects it exposed:

1. **Four *Troubleshoot Site* subflows say "pick these actions in any order you wish"** — and I had turned their button lists into 32 ordering clauses anyway, 18 of them in the recall denominator. polyx was being marked down for failing to find rules the rulebook explicitly declines to make. Dropped, with the quote recorded per clause; the expressible denominator falls 173 → 155 and recall rises 0.497 → 0.555.
2. **Only 48 of the 155 clauses are steps the rulebook lists side by side**; the other 107 are transitively implied pairs I generated by expanding each flow's list into all pairs. Ruling: keep them (a sequential policy *is* violated by doing E before A) but report recall over both denominators, the same strict/lenient treatment used everywhere else.

The second figure then produced the most useful finding of the phase. Adjacent-only recall is **0.229 (11/48)** against 0.555 all-pairs — and the reason is not that polyx is worse at tight rules. Of the 37 missed adjacent clauses, **26 are clauses the ABCD agents themselves broke more than 10% of the time**; polyx is correct to withhold them, and the diff already reports them as compliance gaps. Only 10 are genuine misses. Two candidate explanations were tested and refuted before this one: subsumption pruning costs zero clauses, and raising `maxGuardRules` from 3 to 12 moves adjacent recall not at all.

So a third denominator was added — recall over the clauses **this corpus actually keeps** (139 of 155), where polyx scores **0.604**. It is labelled a diagnostic, never the claim: it separates "polyx missed it" from "the agents do not do it", and the gap between it and the headline *is* the compliance gap. Denominator-shopping is the failure this harness exists to prevent, so all four figures print together and none is called "the" recall.

**Gold alignment (parallel-track items 1 and 5), 29 Aug 2026 — done, single rater.** 61 stratified rule↔clause pairs rated by the operator. The first pass was discarded and re-run, and why is the finding: the surface rendered the mined rule as prose and the clause in bracketed button names, so the differing element — the guard — sat in different notation on each side while the matching element, the action, appeared in both. Thirteen of fifteen near-miss pairs came back confirmed when the guards plainly differed. Rebuilt as an aligned three-row comparison in one vocabulary with the differing row marked; on the re-rate, **fourteen of those answers flipped and the tribal bucket moved by one** — the change was concentrated exactly where the notation had hidden the difference. The first pass is kept in the gold file under `superseded:` with its reason, not deleted.

Result: **31 of 31 pairings the matcher made were confirmed; 26 of 30 it declined were agreed with. Matcher agreement 0.934** (was 0.738 on the misled pass). Precision 0.575 and recall 0.555 now measure the miner rather than the matcher. Inter-rater remains **n/a** — one rater — and the report says so rather than implying more.

The four remaining disagreements were one shape: same action, same guard, **different flow**. Checked against `kb.json`, and in every case the flow polyx mined the rule in genuinely has no such clause. Ruling: the matcher stays strict, and the diff now splits tribal knowledge into **practices extended to a flow the policy never covered (28 on ABCD)** and **practices the rulebook never states anywhere (8)** — folding the first into confirmed would have hidden the product's actual finding.

A gap in the answer key surfaced on the way: `kb.json` keys the FAQ flows coarsely (`pricing`) while the conversations label them finely (`pricing_1..4`), so 50 subflows covering 21.6% of conversations have no clause and any rule mined there can never align. Effect on the headline: 2 rules of 87. Recorded in the clause file under `uncovered_subflows:` and warned about at generation time, rather than left silent.

**Reviewer session (parallel-track item 2), 29 Aug 2026 — surface fixed, timing still outstanding.** No domain reviewer was available, so the operator ran it as an optimistic bound: if the analyst who wrote the alphabet cannot hit 90 seconds, nobody can. The session did not reach a timing figure, because it found two miner defects first — which is a better outcome than the number would have been.

Reading one recommendation rule, the operator observed that `paypal AND gold → update the order` "doesn't make too much sense in isolation". It did not: 34 of its 38 instances sat inside return flows already covered by `intent = return_color → update the order`, and the rule claimed to hold whenever gold and paypal though every instance supporting it was a return or refund. That produced two fixes (TS §7.3 rev. 7) — coverage pruning for recommendations, and an instance floor that scales with antecedent length — taking ABCD from 162 recommendation rules to 63, all flow-scoped and readable.

The surface itself was also wrong for the family: it showed a recommendation an obligation's evidence, with a guard highlight where there is no guard and a counter-example panel that says nothing. It now shows lift against the base rate, the alternatives the agents chose, and how those ended.

Two smaller surface fixes came out of the same session: `raw` was an unexplained link label (now *source record*, with a legend), and a thirty-line wall of `utterance` buried the four events that mattered (now collapsed to a count).

**The timing, measured (28 verdicts, 5.4 minutes):**

| | median seconds per rule |
|---|---|
| **all rules** | **8.4** |
| rules with no counter-examples (19) | 5.9 |
| rules with counter-examples (8) | 16.7 |
| obligations (23) | 6.0 |
| recommendations (4) | 31.6 |

Target is 90 seconds. The median alone would be weak evidence — 8 seconds is fast enough to be either a working surface or a skim — so what makes it credible is that **the pace tracked difficulty**: roughly 3× longer where there was contradicting evidence to weigh, 5× longer on recommendations, where the lift table has to be read rather than a statement checked. The slowest single verdict was 60 seconds. That is a reviewer moving fast through the easy cases and stopping on the hard ones, which is the surface working rather than being ignored.

**What this does and does not establish.** The rater is the analyst who wrote the alphabet and named every action on the screen, so this is an optimistic bound, not an estimate — recorded everywhere as *analyst pace*. It is the one-directional test: had it come in over 90 seconds the surface would have failed F5.4 outright, and it did not. Even at 5–10× slower, a domain reviewer lands at 40–80 seconds, inside the target. **F5.4 is not passed** — that needs a customer-service lead — but the surface is demonstrably not the bottleneck, and the domain-reviewer measurement stays on the partner-conversation checklist.

**One verdict worth keeping.** Of 28, twenty-seven *real* and one *not real*: `intent = cost AND shipping_option = out for delivery → offer a refund` (47/47), rejected after 32 seconds of thought. That is the coincidence pattern one level below the one fixed earlier the same day — a flow plus one incidental slot — and the new coverage pruning did not catch it because no broader rule covered those 47 decision points. **Open question:** whether "flow plus one incidental slot" is systematically coincidental on this corpus, or whether this is one bad rule. Deliberately not chased on the day it was found: two miner changes had already landed from this session, and a third on the same evidence would be tuning to one corpus.

**What is not done.** ADP (F1.4, SHOULD); τ² telecom; the LLM-assisted matcher (the structural one has been enough to measure with, and the gold set it would be scored against does not exist yet); and the parallel-track items that still need a person: the timed session with a *domain* reviewer (item 2 — the analyst-pace bound above is not it), and the second rater for the inter-rater figure (item 1). Items 5 and 7 are done, as recorded above.

---

## 6a. Post-MVP — status, 3 Sep 2026

**This plan is finished.** Phases 0–6 are built, the week-6 gate was measured and returned **BETWEEN**, and everything above stands as written. What follows is not scheduled by this document — it is recorded here so that a reader who takes this plan as the state of the project is not four days out of date. Two workstreams have opened since 29 August, neither of them a phase of the MVP, and both of them consequences of it.

**ACV 1.0 — `docs/acv-1.0-spec.md` — half adopted, on purpose.** The alphabet was doing two jobs in one file: *classification* (`match:` — which raw rows become which event type, derived from a customer's own data and shareable with nobody) and *declaration* (what an action costs, and whether it may ever be recommended). The second is a specification-shaped artefact and is now written as one — profile document, terms, claims, consumer behaviour, JSON Schema and JSON-LD context, normative throughout. Adopted in `0ef7e9f` for the declaration half only: `consequential` + `reversibility` collapse into ACV's single `consequence` ordinal (the pair was redundant and could express states that were silently discarded), and `recommendable` (ACV 6.4) now gates recommendation mining at the point a candidate is emitted. That gate immediately paid for itself — there had been no such gate before, so the recommendation miner ran over every subject and on ABCD proposed an irreversible action (`manage_create → make a purchase`, 75/79). All four alphabets at v2, encoding only: **no mined figure moved**, confirmed by `reproduce.mjs`. `507f0ce` then fixed seven review findings, three of which were violations of the very specification the previous commit adopted — the advisor did not enforce `recommendable` (ACV 8.3, a MUST) so a policy change took effect only on the next re-mine; the audit failed *open* on unknown terms where ACV 8.4 requires the opposite; and a capability was removed under cover of an encoding change. Tests 80 → 96. TS is at rev. 9. **Not done, deliberately:** the classification half stays private and per-customer, and *warrant* — an asserted vendor rule and a rule measured across three operators are not the same verdict — is design-only in TS §7.4 (rev. 8) and lands with the bundle reader, because a column with one value in it is a guess with a schema.

**Expertise — `docs/expertise-concept.md`, `docs/expertise-implementation-plan.md` — planned, Phase 0 not started.** ~9 weeks. Shareable rule bundles, a free open evaluator, install across a vocabulary boundary, and `PreToolUse` triggering inside Claude Code. Its §1 is the part that matters to *this* plan: most of the runtime it needs already exists here and has tests — `Rule` is the shape the concept asks for, `Advisor` is the queried-not-loaded three-valued evaluator, `polyx coverage` is `replay`, the provenance lattice is `own`/`borrowed`/`neither` — so the new work is two boundaries, vocabulary and trust, and that is where all the risk sits. It has its own falsifiable claim and its own gate (mapping cost ≤ 10 min for a ~20-rule bundle; ≥ 0.8 of `neither` verdicts being real norm differences rather than mapping artefacts), stated in advance for the same reason week 6 was. The architectural constraint inherited from here points the other way: **the runtime must not import polyx**, enforced in CI from day one, or the free-and-independent claim quietly stops being true and cannot be recovered.

**CRMArena-Pro.** Written permission requested and granted; terms and what ingestion would require are recorded (`docs/correspondence/`, `DATASETS.md`). No adapter. This retires an open question rather than feeding the MVP, exactly as parallel-track item 4 said it would.

**FS rev. 8 — framing.** §1 defined polyx in terms of a customer-service agent and the header named two CRM verticals as target domains. No requirement in §5 ever depended on that, and BPIC 2017 — no dialogue, no conversational agent — disproved the narrow reading inside this plan's own Phase 6. §1 now states the shape a domain must have (typed actions with declared consequence, episodes, outcomes) and demotes customer service to the domain that made the claim measurable first. No requirement changed.

**What is still not scheduled anywhere.** Everything in §10 below, unchanged. Add to it: the classification half of ACV, the bundle reader, and the "flow plus one incidental slot" question from the reviewer session — the last of which needs a second corpus before it is chased, not a second opinion.

---

## 7. If week 6 fails

Stated in advance, so the decision is not made under pressure.

The falsification response (FS §6.5) is to revisit **the pattern table and the alphabet** — not to proceed to the advisor on a miner that does not work, and not to retune thresholds until the number moves.

Diagnostic order, cheapest first:

1. **Alphabet.** Are event types assigned correctly? `polyx alphabet show` on every consequential type. A single wrong match rule can move a corpus from "7 pushes, 0 verified" to "14 pushes, 12 verified" — the most common cause, and the cheapest fix.
2. **Episode segmentation.** Score against ABCD subflow labels (already built in Phase 1). Every window rests on this.
3. **Alignment.** Is precision low, or is the matcher failing to recognise correspondences a human accepts? Inter-rater agreement and matcher-vs-gold agreement separate these; if the matcher is the problem, the miner may be fine.
4. **Consequence filter.** FS §6.5 names this directly: precision below ~0.4 would mean the pattern table manufactures true-but-useless regularities and the consequence filter is not doing its work. Tighten the consequential set and re-measure.
5. **Pattern table.** Only then — and with the understanding that changing it invalidates the prior figures rather than improving them.

Budget: two of Phase 4's four weeks for a diagnose-and-remeasure loop, taken out of τ² breadth. If the number does not move, the finding is the deliverable, and it is a real one — the approach was falsifiable and it was falsified, on public data, reproducibly. That is worth considerably more than a demo built on a miner nobody measured.

---

## 8. Parallel track — start Week 1

Zero engineering hours, weeks of latency. Every one of these blocks something later if left until its own phase.

| # | Item | Blocks | Start | Needed by |
|---|---|---|---|---|
| 1 | **Recruit the second rater** for the gold alignment | Phase 3, the inter-rater figure | W1 | W5 |
| 2 | **Recruit the domain reviewer** for the timed session (F5.4) | Phase 2 exit | W1 | W5 |
| 3 | **Read BPIC 2017 terms**, record in `DATASETS.md` | Phase 6 (conditional) | W1 | W8 decision |
| 4 | **Email Salesforce AI Research** for CRMArena-Pro written permission | Nothing in the MVP; retires an open question permanently | W1 | — |
| 5 | **Hand-decompose ABCD `guidelines.json` into atomic clauses** with `expressible` flags | **Phase 3, the gate** | **W2** | W5 |
| 6 | **Freeze the τ²-bench backbone** and confirm generation runs | Phase 4 | W6 | W7 |
| 7 | **Move the literature review and architecture doc** out of `polyness/docs/` into the private polyx repo (FS §8) | Confidentiality | W1 | W1 |

Item 5 decides whether week 6 happens on time. It is hand work, it is on the critical path, and it has no engineering dependency beyond the ABCD adapter landing in week 2.

---

## 9. Standing definition of done

Applies to every phase; not restated in each.

- Every printed figure expands to its underlying records in one command.
- Every figure carries alphabet version, corpus revision, thresholds and seed.
- Determinism, redaction, identity-stability and boundary tests stay green. A red boundary test is a **correctness bug**, not hygiene: it means the answer key reached the miner, and every number produced since is suspect.
- No polyx module outside `adapters/polyness/` imports a polyness symbol.
- No LLM call anywhere in the mining path. The LLM appears only in evaluation alignment, where its output is human-adjudicated.
- Nothing reaches the advisor that a human has not adjudicated `real`.

---

## 10. What this plan does not schedule

Deferred by the specs and deliberately unscheduled here, so that scope creep is visible when it happens: the enforcement gate, live agent integration, multi-tenancy, billing, RBAC, PII storage, automatic rule adoption, free-text transcript understanding (FS §1.1), Santander (FS §7), and a Datalog predicate target (TS §1.2 — a new column in the same table whenever it is wanted, not a migration).
