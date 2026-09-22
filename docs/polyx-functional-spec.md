# polyx — Functional Specification (MVP)

**Status:** draft for review · 29 August 2026
**Scope:** mine → advise → evaluate. No enforcement gate in the MVP.
**Evaluation domains:** banking CRM and retail CRM (product advice, returns, support), plus loan origination (BPIC 2017). Where the MVP is *measured* — not the range the method applies to (§1, rev. 8).
**Capacity assumed:** one engineer with agent assistance, ~12 weeks.
**Confidentiality:** polyx is a commercial product; this document is not for the polyness repository.

---

## 1. Purpose

An agent that makes the same kind of decision thousands of times re-infers it thousands of times. polyx reads the interaction records that agent already produces, extracts the rules its own history supports, and serves those rules back so that established decisions stop being re-inferred.

**Customer service is the worked example, not the scope (rev. 8).** What polyx requires of a domain is narrow and stated in §3: actions typed against a reviewed alphabet, each with a declared consequence; a segmentation into episodes; an outcome per episode. Customer service is where that shape is cheapest to find — the consequential actions are already buttons in a CRM — and it is what the MVP is evaluated on, so it is the vocabulary this document uses throughout. It is not a boundary of the method, and the evidence for that is already in the evaluation: **BPIC 2017 has no dialogue, no conversational agent, and no `agent_utterance` at all** — 31,509 loan applications through a bank's own origination process — and the miner runs on it unchanged, at institutional scale (TS §4.3, plan Phase 6). Any agent whose decisions are recorded as typed actions can put polyx in its loop, and a small set of mined obligations is worth having wherever taking the wrong action is expensive to undo. Read *customer service* below as the domain that made the claim measurable first.

The MVP must establish one falsifiable claim before anything is sold:

> Given interaction traces produced under a known policy, polyx recovers that policy — and correctly declines to propose rules the policy does not contain.

Everything in this document exists to make that claim testable on public data, and to make the resulting rule set usable by a person who must sign off on it.

### 1.1 Non-goals for the MVP

| Not in scope | Why, and when |
|---|---|
| Enforcement gate / blocking | Needs a live agent to gate and roughly doubles the build. The rule format must remain gate-compatible (§6.3), but nothing denies in the MVP. |
| Live agent integration | Batch ingestion and a request/response advisor API are sufficient to prove the claim. |
| Multi-tenant SaaS, billing, RBAC | Single-tenant, single-operator, local. |
| Storing customer PII | The MVP works on public datasets and, later, partner-supplied de-identified event streams. It never needs raw PII, and is designed so it never receives it. |
| Automatic rule adoption | Every rule reaching the active set passes a human adjudication step. Non-negotiable in the MVP; revisit only with evidence. |
| Free-text transcript understanding | The alphabet is built from typed actions and structured slots. Transcript NLP is a later capability, and its absence is a design constraint, not an oversight. |

---

## 2. Users

**The analyst** operates polyx. Runs ingestion, reads the audit, adjudicates proposed rules, and publishes an active rule set. Technical, comfortable in a terminal, not necessarily a domain expert.

**The domain reviewer** is a customer-service lead, compliance officer, or product owner. Never uses a terminal. Sees a list of candidate rules in their own vocabulary, each with the interactions that support it and the interactions that contradict it, and answers one question per rule: *is this real?* Their throughput is the binding constraint on the whole system — a review surface that takes more than about 90 seconds per rule will not be used.

**The agent** is a program. It asks the advisor what to do at a decision point and receives either a recommendation with its supporting evidence, or an abstention. It must be able to tell those apart trivially.

---

## 3. Domain model, in plain terms

| Term | Meaning |
|---|---|
| **Interaction** | One customer contact from open to close. The unit a customer would recognise. |
| **Episode** | One coherent task inside an interaction. A customer who asks about a return and then about a refund has one interaction and two episodes. Windows are measured over both, and every rule declares which. |
| **Event** | One typed thing that happened: an agent action, a customer utterance classified to an intent, a system response, an outcome. |
| **Consequential action** | An event you cannot take back, or can only take back at cost: issuing a refund, opening an account, booking, escalating, sending a quote. Rules are mined around these and around nothing else. |
| **Outcome** | What the interaction produced, known later: resolved, escalated, complaint, accepted, churned. |
| **Obligation rule** | A constraint on a consequential action. *Never quote a rate without a disclosure.* Enforceable in principle; advisory in the MVP. |
| **Recommendation rule** | A mapping from state to a suggested action. *If the customer holds A and asked about B, offer C.* Never enforceable; always abstainable. |
| **Provenance** | Whose norm a rule is: this agent, this team, this operator, or borrowed from elsewhere. Governs whether the rule may be proposed at all. |
| **Coverage** | The share of decision points the active rule set answers, against the share handed back to inference. |

---

## 4. Product surfaces

The MVP delivers four surfaces. They are sequenced so each is useful before the next exists.

### S1 · Ingest and audit

The analyst points polyx at a dataset and gets a report: how many interactions, how many episodes, which actions recur, which of those are consequential, and which consequential actions have enough instances to support a rule.

The audit says **nothing** when there is nothing to say, in those words, and reports what fell below the floor and why. A corpus with three refunds produces no refund rules and says so.

Every figure in the audit resolves to the underlying records in one command.

### S2 · Mine and adjudicate

polyx synthesises candidate rules, measures each against the corpus, classifies its provenance, and presents the survivors for review.

The review surface shows, per rule: the rule in domain vocabulary, its support as a fraction, the interactions that satisfy it, **the interactions that contradict it**, and its provenance verdict. The reviewer marks each rule *real*, *not real*, or *needs narrowing*, optionally with a note.

Adjudication decisions persist and survive re-mining. A rule marked *not real* is not re-proposed on the next run unless its supporting evidence has materially changed.

### S3 · Advise, with abstention

An HTTP endpoint takes a decision point — the current episode state, customer facts, and the action under consideration — and returns one of:

- **recommend**, with the action, the rules that fired, and the evidence behind each;
- **warn**, when an obligation rule's antecedent holds and its consequent has not been satisfied;
- **abstain**, with the reason: no rule covers this, or a rule would cover it but a required fact is unknown;
- **clear** *(rev. 4)*, when every adjudicated obligation on the action under consideration holds and nothing is recommended — "go ahead", which is an answer, not an abstention.

The distinction between *no rule applies* and *a rule applies but I lack a fact* is exposed to the caller, because they demand different responses. Abstention is a first-class successful answer, not an error.

### S4 · Conformance diff

Given a written policy alongside a mined rule set, polyx produces the three-region report: rules followed but never written, rules written but not followed, and rules confirmed by both — plus contradictions found within the mined set.

This is the surface a domain reviewer will value first and the one that needs no agent deployed.

---

## 5. Functional requirements

Acceptance criteria are stated so they can be tested. `MUST` is MVP-blocking; `SHOULD` is expected but may slip.

### 5.1 Ingestion

**F1.1** polyx MUST ingest ABCD, τ²-bench trajectories, and BPIC 2017 through separate adapters producing one canonical record shape.
*Accept:* each adapter has a fixture test asserting field-level output for at least three hand-checked interactions.

**F1.2** polyx MUST reject a corpus it cannot classify rather than mining it silently. An adapter that cannot determine an event's type emits an `unknown` event and the audit reports the unknown rate.
*Accept:* a corpus with >20% unknown events produces a warning banner in the audit and refuses to emit proposals.

**F1.3** polyx MUST redact identifiers at ingestion, before anything is persisted.
*Accept:* a test corpus seeded with synthetic account numbers, emails and phone numbers produces zero occurrences in any stored artefact.

**F1.4** polyx SHOULD ingest any Agent Data Protocol trajectory without a bespoke adapter.

### 5.2 The alphabet

**F2.1** The set of event types, and the rule for assigning an event to a type, MUST be an explicit, inspectable, per-corpus artefact — not implicit in code.
*Accept:* the alphabet for each corpus can be printed, edited and re-applied without changing source.

**F2.2** Changing the alphabet MUST re-derive every downstream number, and the audit MUST record which alphabet version produced it.
*Accept:* two audits produced under different alphabet versions are distinguishable from their output alone.

**F2.3** The analyst MUST be able to see, for any event type, the raw records assigned to it — to check the assignment is right before trusting any figure built on it.

### 5.3 Consequence and episodes

**F3.1** The consequential-action set MUST be per-domain configuration reviewable by a domain expert, not a constant in code.

**F3.2** *(rev. 8)* Each action type MUST carry a declared **consequence** on ACV 1.0's ordinal — `none`, `reversible`, `compensable`, `irreversible` (ACV §6.3). Mining is restricted to types at or above a floor defaulting to `compensable` (ACV §8.2): a `none` action changes nothing outside the acting system, and a `reversible` one prevents a mistake that is free to make. An action type that declares no consequence is refused at load; a type encountered with no declaration at all is treated as `irreversible` and not recommendable, never as `none` (ACV §8.4).

*Superseded:* rev. 7 read "each consequential action MUST carry a declared reversibility: irreversible, costly, or free". That pair is no longer accepted by the parser — `costly` became `compensable`, `free` and `consequential: false` both became `none`, and the redundant `consequential` boolean is gone.

**F3.4** *(rev. 8)* Each irreversible action MUST declare **`recommendable`** (ACV §6.4); below that tier it defaults to true. An advisory engine MUST NOT propose an action declared `recommendable: false`, and the declaration is read from the alphabet at serve time rather than from the stored rule, so a policy decision takes effect without a re-mine. Candidates the gate withholds MUST be counted and reported, never silently dropped.

*Accept:* an alphabet declaring an irreversible action without `recommendable` fails to load; setting it false removes that action's rules from both the mine output and the advisor, and both say how many.

**F3.3** Episode segmentation MUST be reported with its own quality figure, since every window depends on it.
*Accept:* the audit states episodes per interaction and the share of episodes containing zero consequential actions.

### 5.4 Mining

**F4.1** polyx MUST mine obligation rules across at least the four constraint patterns polyness implements, extended with data conditions on customer state.

**F4.2** polyx MUST mine recommendation rules as antecedent → suggested action, with measured precision against realised outcomes.

**F4.3** Every rule MUST carry: its support as holds/of, the window measured over, its provenance verdict, its counter-examples, and a stable identity across runs.
*Accept:* a rule's identity is unchanged by re-mining an unchanged corpus; adding one interaction changes support but not identity.

**F4.4** polyx MUST refuse to propose a rule lacking own evidence, at any confidence, while still permitting it to be scored on request.

**F4.5** Provenance MUST support at least four levels — agent, team, operator, borrowed — with the level at which evidence was found named in the verdict.

**F4.6** polyx MUST detect contradictions within a proposed rule set and report them rather than emitting both.
*Accept:* a seeded pair of mutually exclusive rules is reported as a contradiction, not proposed.

### 5.5 Adjudication

**F5.1** The review surface MUST present, per rule, both supporting and contradicting evidence. A rule shown without its counter-examples is a defect.

**F5.2** Adjudication MUST persist across re-mining runs, keyed on rule identity.

**F5.3** A rule marked *not real* MUST NOT be re-proposed unless its support has changed beyond a stated threshold, and the reason for re-proposal MUST be shown.

**F5.4** The reviewer MUST be able to complete a rule in one screen without navigating away. *Target: median 90 seconds per rule, measured on a real reviewer, not estimated.*
*Status (rev. 7):* the surface exists and records the pace automatically. Measured on the analyst, 29 Aug 2026: **median 8.4 seconds** over 28 verdicts (5.9s with no counter-evidence, 16.7s with, 31.6s for recommendations). That is an optimistic bound and is labelled as such wherever it appears — the rater wrote the alphabet. It settles the one-directional question (the surface would have failed at over 90 seconds and did not) and leaves the domain-reviewer measurement outstanding, deferred to the first design-partner conversation.

### 5.6 Advisor

**F6.1** The advisor MUST return `recommend`, `warn`, or `abstain`, and MUST distinguish *uncovered* from *unknown-fact* abstentions.

**F6.2** Every non-abstaining response MUST carry the rules that fired and, per rule, the evidence that justified its adoption.

**F6.3** A missing fact MUST cause abstention, never a negative evaluation. Absence of a record is never treated as evidence of absence.
*Accept:* a test where a required fact is removed produces `abstain`, not a changed recommendation.

**F6.4** The advisor MUST serve only rules that have been adjudicated *real*. Proposed-but-unreviewed rules are never served.

**F6.5** The advisor SHOULD respond within 50ms at p95 for a rule set of 500 rules.

### 5.7 Measurement

**F7.1** polyx MUST report coverage — decision points answered, abstained as uncovered, abstained as unknown — as a single reproducible figure per corpus.

**F7.2** polyx MUST report, for the served rule set, how often a fired recommendation matched the action actually taken and the outcome that followed.

**F7.3** polyx MUST report inference displaced: decision points answered by a rule that would otherwise have required a model call.

### 5.8 Conformance diff

**F8.1** Given a machine-readable policy, polyx MUST produce the three-region diff plus intra-set contradictions.

**F8.2** Every diff finding MUST link to the interactions supporting it.

**F8.3** The alignment between a mined rule and a policy clause MUST be presented as a proposal for human confirmation, never as a determination. Alignment is the least reliable step in the system and must be labelled as such wherever its output appears.

---

## 6. The evaluation the MVP must pass

This section is the reason the MVP exists. Everything else is machinery for it.

### 6.1 The primary experiment — ABCD

ABCD is 10K+ **human-to-human** customer-service conversations with typed actions, published alongside `guidelines.json`: the machine-readable form of the guidelines the human agents were actually following.

That combination is rare and it is the point. Mine rules from the conversations; score them against the guidelines.

- **Precision** — of the rules polyx proposes, what share correspond to a real guideline clause.
- **Recall** — of the guideline clauses that are expressible in polyx's rule language, what share are recovered.
- **Refusal correctness** — of the candidate rules polyx refuses for want of own evidence, what share are genuinely absent from the guidelines. *A correct refusal is a result, and it is the one nobody else reports.*

**Target for MVP exit:** precision ≥ 0.70, recall ≥ 0.50 on expressible clauses, refusal correctness ≥ 0.80. These are first-corpus numbers and are expected to be wrong in both directions; the requirement is that they are measured and reproducible, not that they are high.

### 6.2 The secondary experiment — τ²-bench

τ²-bench ships domain policies for `retail`, `telecom` and `banking_knowledge`, and generates trajectories on demand. That gives unlimited traces under a known policy at no data-governance cost.

**It carries a confounder that must be controlled.** The agent producing those trajectories was handed the policy in its prompt. Recovering a policy from an agent that was told the policy is partly circular. Two controls:

1. Report recall separately on the subset of clauses the agent **violates at least sometimes**. A clause never violated in the corpus is trivially recoverable and says little.
2. Include failed and abandoned trajectories, not only successful ones.

τ²-bench is therefore the **volume and ablation** corpus — for threshold sensitivity, scaling behaviour, and the cross-domain provenance question — while ABCD carries the headline claim, because human agents were never handed a prompt.

### 6.3 The banking experiment — BPIC 2017

Real loan-application event logs from a financial institution: genuine consequential events, genuine outcomes, no dialogue and no agent. Used for two things the conversational corpora cannot provide:

- obligation mining against real institutional process at scale;
- the four-level provenance question — does a rule mined from one case type hold for another.

No policy document exists for it, so it contributes no precision/recall figure. It contributes realism.

### 6.4 Cross-domain provenance

The experiment polyness runs across projects, transposed: mine a rule in one τ²-bench domain or one ABCD flow, and score it in the others. Report where own evidence, borrowed evidence, and no evidence land. This tests the provenance concept directly and is the finding most likely to survive contact with a partner.

### 6.5 What would falsify the approach

Stated in advance, so the result means something:

- Precision below ~0.4 on ABCD would mean the pattern table mostly manufactures true-but-useless regularities, and the consequence filter is not doing the work polyness's §1.1 measurement claims.
- Refusal correctness at chance would mean provenance is decoration.
- Coverage that plateaus below ~10% of decision points would mean the expert system never displaces enough inference to pay for itself, whatever its precision.

---

## 7. Datasets and their licences

**Intended use is internal testing and validation — no redistribution of any dataset, and no dataset shipped inside the product.** That posture removes most licensing risk outright: redistribution is what the majority of dataset terms actually restrict, and polyx does none of it.

One distinction survives that posture and is worth holding onto:

- **Numbers out** — running an evaluation and reporting a metric — is low risk under every licence below.
- **Artefacts in** — a mined rule set derived from a corpus that ends up shipping, or informing a shipped rule set — is a different question, because the artefact is arguably derivative even when the data never moves.

Keeping evaluation corpora separable from product artefacts is therefore an engineering habit worth having regardless of licence, and it happens to make the licensing question mostly moot.

| Dataset | Licence | Verified | Use in polyx |
|---|---|---|---|
| **ABCD** | MIT | ✅ confirmed on repo | Primary evaluation corpus. Commercial use permitted with attribution. |
| **τ²-bench** | MIT | ✅ confirmed on repo | Trajectory generation and ablation. Commercial use permitted with attribution. |
| **CRMArena-Pro** | CC-BY-NC-4.0 | ✅ confirmed on the dataset card | Usable for internal evaluation under the numbers-out rule. NC restricts use "primarily intended for or directed toward commercial advantage" — a boundary CC deliberately leaves imprecise, and which pre-revenue R&D sits near rather than clearly inside. Keep derived artefacts out of the product, and **email Salesforce AI Research for written permission** — NC licensors commonly grant it, and one reply retires the question permanently. |
| **BPIC 2017** | 4TU.ResearchData terms | ⚠️ not yet read | Published for research use and widely used in the process-mining literature; almost certainly fine for internal evaluation. Read the landing page once and record it. |
| **Santander Product Recommendation** | Kaggle competition rules | ⚠️ not yet read | The one genuinely likely to restrict, since competition rules often limit use to the competition itself. Deferred out of the MVP anyway — read before any use. |
| **Agent Data Protocol** | released publicly, terms per constituent dataset | ⚠️ per-dataset | Schema target. The *schema* is safe to adopt unconditionally; each constituent corpus carries its own licence and is only relevant if actually ingested. |

**MVP decision:** ABCD and τ²-bench carry the entire headline evaluation (§6.1–6.2) and are both MIT, so the MVP as specified has no licensing exposure at all. BPIC is a realism check; read its terms before ingesting. CRMArena-Pro stays available for internal comparison, with permission sought in parallel. Santander remains out of scope.

Maintain `DATASETS.md` as a running register of what was used, under what terms, and for what. Not because the current use is risky — it is not — but because a bank's vendor-risk questionnaire, a partner's diligence, or an acquirer will ask, and reconstructing it two years later is far worse than keeping it as you go.

---

## 8. Commercial and open-source boundary

polyness is Apache-2.0. That permits use inside a closed commercial product provided the licence text and attribution are preserved and modifications are marked. It does **not** oblige polyx to be open.

Two consequences that shape the build:

**The polyness dependency is optional by design.** polyx defines its own interfaces for episode segmentation, subject extraction and provenance classification, and polyness is one implementation behind them. If the dependency is dropped — for licence hygiene, for divergence, or because the CRM alphabet pulls too far from the dev-tool one — it is an adapter swap, not a rewrite. The technical spec makes this a hard architectural rule.

**Commercial documents do not go in the open repository.** This specification, the technical spec, and the partner materials belong in the private polyx repository. *The literature review and architecture document currently committed to `polyness/docs/` should be moved* — the review contains partner strategy and IP structuring, and the architecture document describes the commercial product.

What stays open, if anything: the reader adapters and the canonical trace schema are plausible open-source contributions that cost nothing commercially and buy standing in the process-mining and agent-observability communities. The alphabet work, the recommendation family, the advisor, and the conformance diff are the product.

---

## 9. Milestones

Each is demoable on its own; nothing depends on a later one.

| Week | Milestone | Demonstrable |
|---|---|---|
| 2 | ABCD ingested, audit runs | "Here is what this corpus repeats, and here is what it does not support." |
| 4 | Obligation mining + provenance, review surface | A list of candidate rules with evidence and counter-evidence, reviewable. |
| 6 | **Evaluation harness, first ABCD precision/recall** | The falsifiable claim, with a number attached. The most important date. |
| 8 | τ²-bench generation + ablation, cross-domain provenance | Threshold sensitivity, and where borrowed evidence actually lands. |
| 10 | Recommendation rules + advisor with abstention | A live endpoint that recommends or abstains, with coverage measured. |
| 12 | Conformance diff + BPIC | The three-region report a domain reviewer can read. |

Week 6 is the gate on everything after it. If the ABCD numbers fall in the falsification range of §6.5, the correct response is to revisit the pattern table and the alphabet, not to proceed to the advisor.

---

## 10. Open questions

1. **Alignment reliability.** Matching a mined rule to a policy clause is the weakest link in the evaluation, and an LLM-assisted matcher is itself a source of error. Needs a human-adjudicated gold alignment on a sample, and a reported inter-rater figure, or the headline precision number means less than it appears to.
2. **Whether recommendation rules clear the floor at all.** Obligations recur by nature; recommendations may be too sparse per customer segment to reach five instances. If they do not, the advisor is an obligation-warning service, which is a smaller but still real product.
3. **Thresholds.** Inherited from one dev-tool corpus and circular there. The MVP is the first honest second domain; treat every floor as provisional and report sensitivity rather than tuning to a number.
4. **Episode segmentation quality in conversational data.** A worse problem than in shell transcripts, and every window rests on it. *Partly answered at Phase 1 (rev. 1):* ABCD has exactly one subflow per conversation, so its ground truth is one episode per interaction and the null segmenter is correct on it by construction; the intent-boundary (polyness) segmenter agrees on only 13.2% of conversations, and the audit now reports this agreement figure for any corpus whose source states an episode count. *Answered at the cc corpus (rev. 9):* Claude Code transcripts DO ship ground truth for the several-tasks-per-contact case — every record carries the prompt it was produced under — and there the ranking reverses: null 42.6%, intent-boundary 67.4%. So neither segmenter is right in general and the choice belongs to the corpus, not to the installation (TS §2, §15 rev. 10). It stays open for the partner case, where no ground truth ships.
5. **Whether the interaction window assumes a contact is a unit of work.** *(new, rev. 9)* `no-X-without-prior-Y` measures across the whole contact, which is right when a contact is one task — ABCD has exactly one subflow per conversation, τ² one scenario per simulation — and wrong when it is not. On the `cc` corpus a contact is a multi-hour working session holding a median of twenty tasks, and every noisy top rule there is interaction-window: *"somewhere earlier in the contact you listed a directory"* is true, unviolated and not a precondition. The corpus already carries the figure that decides it (`expected_episodes`), so this is answerable rather than merely arguable: the window should probably scale with what a contact is, not be a constant of the pattern table. Not fixed at the point it was found, on purpose — see TS §15 rev. 10. *Second corpus, same day:* `cc-mimo` (public, MIT, 859 Claude Code sessions, **1.00 episode per contact**) is the control — same adapter, same alphabet, one variable changed — and there both segmenters agree 100%, the two windows coincide, and the rule set is 117 readable rules with counter-examples rather than 3,351. The pattern table is not wrong; its window assumption is, and it is measurable per corpus. ***Closed, same day (rev. 10), and the closing corrected (rev. 11):*** the fix is a vacuity test rather than a threshold — a contact-scoped rule is suppressed when the guard already preceded the subject in every contact, so the premise it asks about was never in question (TS §15 rev. 11, rev. 12). It removes a fifth of `cc`'s rule set (3,351 → 2,703), takes one rule on `cc-mimo` and **none at all** on ABCD and τ² retail, where a contact really is a unit of work and no contact rule was ever vacuous. Nothing else moves: ABCD and τ² keep their precision and recall to the digit, and `cc` keeps its recall at 0.857 and all 12 of 14 recovered clauses. Rev. 10 reported this differently — a precision rise on ABCD and τ², one rule each, and a recovered clause spent — and every one of those figures was an artefact of measuring vacuity over the wrong window; see TS §15 rev. 12 for what was measured and what it cost.
6. **Whether a corpus that cannot be redistributed can carry a headline figure.** *(new, rev. 9)* `cc` is one person's own machine (DATASETS.md). Its numbers are reportable and its corpus is not reproducible by a reader, which is a weaker claim than every other figure in §6 makes. The MVP's answer is that it carries diagnostic weight only and is never a headline; whether a customer's own corpus can ever carry more than that is a question for the partner conversation, not for this document.

---

## 11. Revision log

**rev. 11 — 4 Sep 2026. §10.5's closing figures were wrong; the closing stands.** The vacuity test rev. 10 announced was measured over the whole contact rather than over the window the rule is measured on, so it also suppressed rules the corpus demonstrably violated (TS §15 rev. 12). Corrected, it fires on `cc` — the corpus whose contacts are not units of work — and nowhere else: **ABCD and τ² retail lose no rule and no precision**, so rev. 10's "precision rises and recall does not move" is withdrawn, and the ABCD 0.529 → 0.535 and τ² 0.524 → 0.550 gains it reported did not exist. `cc` keeps its recall at 0.857 and the clause rev. 10 booked as the price of the fix. §10.5 stays closed: the premise test is still the right fix, and it still removes 648 of `cc`'s rules. §6.1's gate verdict is unchanged — **BETWEEN** — and no requirement changed.

**rev. 10 — 3 Sep 2026. §10.5 closed.** The interaction window now tests its own premise (TS §15 rev. 11). ABCD's headline precision moves 0.529 → 0.535 strict, 0.575 → 0.581 lenient, with recall unchanged; τ² retail 0.524 → 0.550. §6.1's gate verdict is unchanged — still **BETWEEN**, and still short of the 0.70 exit target — so nothing in §6 is restated on the strength of a six-thousandth. No requirement changed.

**rev. 9 — 3 Sep 2026. A fourth corpus, and two open questions it opened.** The `cc` corpus (TS §4.4, §15 rev. 10) adds Claude Code transcripts — an AI agent taking consequential actions against real systems, 141 sessions across 34 projects. No requirement changed: it runs through §5 as written, which is itself the rev. 8 point demonstrated a second time. **§10.4 is answered in the direction it was open in** — the corpus ships segmentation ground truth for contacts holding several tasks, the intent-boundary segmenter scores 67.4% there against 13.2% on ABCD, and the conclusion is that neither segmenter is right in general. Two questions are added rather than resolved: §10.5, whether the interaction window's assumption that a contact is a unit of work survives a corpus where it plainly is not; and §10.6, what weight a figure may carry when its corpus cannot be redistributed. The second is a question this document should have been asked to answer before now, and the MVP's answer is the conservative one — diagnostic only, never a headline.

**rev. 8 — 3 Sep 2026. Framing, not requirement: customer service is the worked example, not the scope.** §1 opened by defining polyx in terms of a customer-service agent, and the header named two CRM verticals as *target domains*. Nothing in §5 ever depended on that: the requirements are stated over typed actions, episodes and outcomes, and BPIC 2017 — no dialogue, no conversational agent, 31,509 loan applications — was ingested and mined without a requirement changing, which is the disproof of the narrower reading sitting inside the MVP's own evaluation. §1 now states the shape a domain must have and demotes customer service to the domain that made the claim measurable first; the header reads *evaluation domains*. No functional requirement is added, removed or altered by this revision. Two consequences are deliberately left for later documents rather than smuggled in here: the same separation drives ACV 1.0's split of the alphabet into a shareable declaration and a private classification (TS §5, rev. 8–9), and the question of an agent calling the advisor inside its own tool loop belongs to `docs/expertise-concept.md`, not to this MVP.

**rev. 7 — 29 Aug 2026.** F4.2 tightened after a reviewer session: recommendations gain redundancy pruning and an antecedent-length-scaled instance floor (TS §7.3 rev. 7). No requirement changed; the miner was over-generating and the surface was showing the wrong evidence for the family. Worth recording that both defects were found by a person looking at one rule and saying it did not make sense — which is the argument for F5.4's review step existing at all.

**rev. 6 — 29 Aug 2026.** §6.1's recall is reported over four denominators (see TS §9.3 rev. 6) after a human review of the ABCD clause decomposition removed 18 clauses the rulebook never asserted. §10.1 (alignment reliability) remains open: the answer key has now been read by a person, but no gold rule↔clause alignment exists and no second rater has been recruited.

**rev. 5 — 29 Aug 2026, after Phase 6.** F1.1 complete for ABCD, τ² and BPIC (each with three hand-checked interactions); F8.1–F8.3 built; §6.3 delivered (BPIC ingested under recorded terms). Every MUST in §5 has an implementation and a test except F5.4's measurement, which needs a person. Outstanding SHOULDs: F1.4 (ADP), F6.5 measured in-process only.

**rev. 4 — 29 Aug 2026, after Phase 5.** F4.2, F6.1–F6.5, F7.1–F7.3 built and tested. §S3 gains the `clear` verdict. §10.2 answered in both directions: recommendations clear the floor on ABCD (162 rules) and not on τ² retail (no facts, no intents), where the advisor is an obligation-warning service. Coverage ceilings measured (ABCD 94.2%, τ² retail 99.1%) with every proposed rule treated as real; the served figure stays 0% until a reviewer adjudicates, by design (F6.4).

**rev. 3 — 29 Aug 2026, after Phases 3–4.** §6.1 measured on ABCD (precision 0.575 lenient / 0.529 strict, recall 0.497, refusal correctness 1.000 — BETWEEN, no gold yet). §6.2's confounder controls are in code and the τ² retail result is the textbook case: headline recall 0.733, recall over clauses the prompted agent ever violated 0/2. §6.4 answered on ABCD flows (borrowed evidence lands where a reader expects) and shown uninformative across τ² backbones (same prompt everywhere). §10.3 partly answered: the instance floor, not the implication floor, moves precision. F1.1's τ² adapter has its three hand-checked simulations. Open: gold alignment (§10.1), and whether the at-most-once floor should be corpus-relative.

**rev. 2 — 29 Aug 2026, after Phase 2.** F4.1–F4.6, F5.1–F5.3 built and tested against the synthetic oracle corpus; F5.4's surface built, its measurement outstanding. Two clarifications of intent, not changes of requirement: a rule with own evidence but below its pattern's implication floor is a habit and is not proposed (it is not a "refusal" — F4.4's refusals are rules with no own evidence at any confidence, and those are kept for §6.1's refusal-correctness figure); and the same rule mined for two operators is two adjudications, not one.

**rev. 1 — 29 Aug 2026, after Phases 0–1.** §10.4 partly answered (segmentation ground truth on ABCD). F1.1's "three hand-checked interactions" fixture exists for ABCD and the synthetic oracle corpus. F3.3's quality figure is the audit's `segmentation agrees with the source's episode count` line. No requirement changed.
