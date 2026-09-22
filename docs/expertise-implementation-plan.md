# Expertise — Phased Implementation Plan

**Status:** draft · 29 August 2026
**Companion to:** `docs/expertise-concept.md`
**Capacity assumed:** one engineer with agent assistance · ~9 weeks
**Confidentiality:** this plan is commercial; the *artefact* it plans is intended to be open (concept §9).

---

## 0. How to read this plan

The concept document ends with a build order (§11: spec the bundle → write three by hand → evaluator → replay → wire polyx in). That order is right in its instinct — **format first, miner last** — and this plan keeps it. It changes two things, for reasons argued below:

1. **The vocabulary boundary is tested in Phase 1, not discovered in Phase 5.** §10 calls the alphabet mismatch "the single biggest obstacle to sharing actually working, and it is unsolved". §11 then proposes writing three bundles by hand — which, done by one person, will use one vocabulary and will make Phase 3's replay demo work beautifully and prove nothing. The three hand-written bundles must be authored against **three different vocabularies on purpose**, because the closing demo ("you installed a stranger's expertise") is *entirely* a claim about crossing a vocabulary boundary.
2. **There is a gate.** polyx's plan put a falsifiable claim at week 6 and made everything after it conditional. The same discipline applies here and the claim is stated in §2. Without it, this is a format nobody can prove is worth adopting.

Three principles otherwise inherited from the polyx build, because they were bought with real mistakes:

**The free/paid split is an architectural constraint, not a licence note.** polyx keeps polyness behind ports so the dependency can be dropped by swapping an adapter. Expertise needs the same rule pointing the other way: **the runtime must not import polyx**, enforced in CI from day one. If polyx and the runtime share code by convenience, the "free, open, independent" claim in §9 quietly stops being true and cannot be recovered later.

**Anything that will be published is expensive to change.** A name, a bundle schema, a verdict vocabulary. §9 argues for publishing the spec "sooner than feels comfortable" — which makes Phase 0 and Phase 1 the phases where care is cheapest and mistakes are permanent.

**A figure without its counter-evidence is a claim.** §3 already says the format should refuse to serialise a rule without its counterexamples. Make the *validator* enforce it, not the convention.

---

## 1. What already exists

This is the part the concept document does not account for, and it changes the estimate substantially. polyx is not a prerequisite for expertise — but it is a **working reference implementation of most of the runtime**, and the parts below have tests.

| Concept asks for | polyx has, today | Where |
|---|---|---|
| Rules with support, counterexamples, provenance, retirement | `Rule` — exactly the §3 shape, plus `scope`, `corpus`, `alphabetVersion`, lifecycle | `src/rule.ts`, `src/store/rules.ts` |
| Queried-not-loaded evaluator, three-valued | `Advisor` — forward chaining over a fact base, absent fact is `unknown`, never `false` | `src/serve/advisor.ts` |
| The verdicts | `recommend` / `warn` / `clear` / `abstain(uncovered \| unknown_fact)` | same |
| `replay` against a local corpus | `polyx coverage <corpus>` — replays every decision point, reports coverage, agreement, outcome precision | `src/serve/coverage.ts` |
| `own` / `borrowed` / `neither` | the provenance lattice, broadest-level-first, behind a port | `src/mine/provenance.ts`, `src/ports/provenance.ts` |
| `alphabet.yaml` | versioned, reviewable, stamped on every derived figure | `src/alphabet/`, `alphabets/*.yaml` |
| Predicate emission | JS closures, emitted per pattern, one target column | `src/mine/patterns.ts` |
| Retirement with a reason | automatic on support decay, reason recorded | `src/store/rules.ts` |
| Conflict detection | contradiction detection over precedence cycles | `src/mine/contradictions.ts` |
| Evidence a human can read | the review surface, one rule per screen with counter-evidence | `src/review/server.ts` |

**What is genuinely new**, and is therefore what this plan is actually about:

- the bundle format, its schema and validator
- crossing a **vocabulary** boundary at install
- crossing a **trust** boundary: signing, attestation, a transport-safe predicate language
- `PreToolUse` triggering inside Claude Code
- conflict surfacing *between installed bundles* (polyx detects contradictions within one mined set)
- the CLI and the transcript visibility

A rough consequence: the evaluator is a port of existing, tested code rather than new work, and the risk concentrates almost entirely in the two boundaries.

---

## 2. The claim this must falsify

polyx's MVP was built around one falsifiable sentence. Expertise needs its own, and the concept's closing demo is nearly it already:

> **A recipient can determine which of a stranger's rules hold for them, on their own data, in one command, without trusting the author — and the vocabulary mapping that requires is cheap enough that they actually do it.**

Two measurements, stated in advance so the result means something:

| | target | falsification |
|---|---|---|
| **Mapping cost** — time for a competent recipient to map an unfamiliar bundle's alphabet onto their own | ≤ 10 minutes for a ~20-rule bundle | > 1 hour, or requires the author's help |
| **Replay signal** — of the rules that come back `neither`, the share that are genuinely not the recipient's norm rather than mapping artefacts | ≥ 0.8 | ≤ 0.5, i.e. replay is mostly reporting the mapping, not the norms |

The second is the one to watch. If most `neither` verdicts turn out to be vocabulary mismatches, `replay` is an elaborate way to measure your own mapping errors, and the sharing story in §4 does not stand up. That is the concept's own §10 worry, made measurable.

**What falsification would mean, decided now:** not that the format is worthless — a *local* expertise (mined by polyx from your logs, run by the free evaluator, never shared) still works and still beats a skill. It would mean the **sharing** claim is dropped to "shared bundles need a per-ecosystem vocabulary" and the roadmap becomes a standards effort rather than a product one. Say that out loud before measuring, not after.

---

## Phase 0 — The three decisions that are expensive to reverse (2–3 days)

No code. Three things that constrain everything downstream and cost nothing now.

1. **The name.** §10 flags it: *practice* is arguably more accurate ("something you do repeatedly" is literally what gets mined) and avoids the grandiosity of *expertise*. Against: *expertise* pairs better with *skill*, which is most of the rhetorical work. **Decide and stop revisiting** — after publication this is a migration, not an edit. My weak preference is *expertise*, purely because the skill pairing is what makes the concept legible in one sentence, and legibility is the scarce resource.
2. **Repo, licence, dependency rule.** A separate repository, permissive licence (Apache-2.0 or MIT), and a CI check asserting **no import of polyx anywhere in the runtime**. polyx's own boundary check (`scripts/check-boundary.mjs`) is the template — it exists precisely because a structural rule nobody checks is a wish.
3. **The predicate representation.** §8 identifies this correctly: JS closures are executable code and shipping them across a trust boundary is the format's honest weak point. The decision is not *whether* to restrict but *when*: a restricted language from the start costs Phase 1 time and saves a format migration; closures-now-restricted-later means the first published spec ships the unsafe form. **Recommendation: define the restricted form in the spec from v0** (Datalog-shaped, no I/O, guaranteed termination), permit closures only for bundles marked `local`, and make the validator refuse a closure in anything signed for distribution. This is the one Phase 0 decision I would argue hardest for, because it is the only one that cannot be fixed by a later version bump without breaking every published bundle.

**Exit:** the three decisions written down with their reasons, in the concept document.

---

## Phase 1 — The format, and the vocabulary test (≈1.5 weeks)

**Goal:** a published spec, and three bundles that prove the format can carry knowledge it did not author.

1. **Bundle spec + JSON Schema**, the §3 anatomy. Two corrections from polyx's experience:
   - the rule shape needs **`scope`** and **`alphabetVersion`**. polyx learned the first the hard way — the same rule identity mined for two operators is two rows with independent support and status, and a schema keyed on identity alone silently overwrites one with the other.
   - `support` and `counterexamples` are required, and the validator **fails** on a rule with `of > holds` and an empty counterexample list. §3 says the format should refuse; make it refuse.
2. **The validator**, as a standalone binary. It is the cheapest possible piece of the free half and the one that makes the format real.
3. **Three hand-written bundles against three different vocabularies.** Not `verified-push`, `verified-push-2`, `verified-push-3`. Something like: one shell/CI vocabulary, one retail-support vocabulary (`action:issue_refund`…), one written by someone else entirely without sight of the other two. **This is the phase's real deliverable** — the bundles are the test fixture for the Phase 3 gate, and if they share a vocabulary the gate is rigged.
4. **`EXPERTISE.md` convention** — what a human reads before installing. §3 is right that keeping it out of the runtime is what stops the format collapsing back into a skill.
5. **Publish the spec.** §9's argument to publish early is sound and the cost is low: a schema and three examples.

**Exit:** the schema validates the three bundles; it rejects a rule missing counter-evidence; the spec is public.

---

## Phase 2 — The evaluator (≈1.5 weeks)

**Goal:** a free, open, standalone runtime that correctly runs a hand-written bundle and imports nothing of polyx's.

1. **The query API.** State in, verdict out. Port `src/serve/advisor.ts`: forward chaining, three-valued, absent fact is `unknown` and never `false`. That last property is the whole reason expertise can say "I don't know" (§2), and it has a test in polyx that is worth porting verbatim.
2. **The verdict vocabulary — and a correction to the concept.** §5 lists three verdicts (`permit` / `warn` / `abstain`). **polyx found three insufficient and it cost a wrong number to discover.** A decision point where every obligation applied and every one held is *not* a permit-by-default and *not* an abstention: it is a positive answer ("go ahead, and here is what was checked"). Counting it as abstention reported τ²-retail coverage as **4.6%** when the advisor was in fact answering **99.1%** of decision points. Recommend the spec carry four: `recommend` (a recommendation fired), `warn` (an obligation is unsatisfied), `clear` (obligations applied and held), `abstain` (uncovered, or a fact is missing). The distinction between *nothing applied* and *things applied and passed* is what makes "inference displaced" measurable at all.
3. **Zero-polyx CI check.**
4. **Firing is visible.** §6 is right that a quiet expertise is indistinguishable from an absent one. The evaluator emits a structured record per query; the harness renders it.

**Exit:** the three Phase 1 bundles run; the abstention test is green; CI proves no polyx import.

---

## Phase 3 — **The gate: cross-vocabulary replay** (≈1.5 weeks)

**Goal:** the claim in §2, measured. Everything after this phase is conditional on it.

1. **`replay <bundle>` against a local corpus** — for each rule, score it against the recipient's own history and report `own` / `borrowed` / `neither` with support. This is largely `src/serve/coverage.ts` plus `src/mine/provenance.ts`; the *new* part is that the rules came from outside.
2. **The mapping step, and its cost.** Installing a foreign bundle requires mapping its alphabet onto the recipient's. Build the smallest thing that works — a `mapping.yaml` beside the install — and **time a real person doing it** for each of the three bundles.
3. **Attribute every `neither`.** For each rule that fails to hold locally, classify: genuinely not this recipient's norm, or an artefact of the mapping. This is the ratio the gate turns on, and it needs a human read on a sample, exactly as polyx's gold alignment does.
4. **Ship a conformance fixture per bundle** (§10's suggestion). It answers "replay needs a local corpus" for a new user on day one. Be honest in the output that it is the *author's* fixture and therefore a weaker claim than the recipient's own logs — polyx's habit of printing the denominator's provenance beside the figure applies directly.

**The gate:**

| outcome | action |
|---|---|
| mapping ≤ 10 min and ≥ 0.8 of `neither` verdicts are genuine | proceed |
| between | proceed, carry the number in every demo, and spend Phase 5 on reducing mapping cost rather than on polish |
| mapping > 1 hr, or ≤ 0.5 genuine | **stop.** Drop the cross-organisation sharing claim; the product is local expertises plus a per-ecosystem vocabulary effort |

**Exit:** the demo sentence from §11 either runs truthfully on a bundle the operator did not author, or does not.

---

## Phase 4 — Triggering inside Claude Code (≈1 week)

1. **Positional triggering via `PreToolUse`.** The bundle declares the action types it has rules about; the hook consults the evaluator before a matching action. Deterministic, sub-millisecond, fires before the effect (§5).
2. **Action-type mapping** — Claude Code tool calls onto bundle action types. This is the vocabulary problem again, in a smaller and much more tractable form (one fixed tool surface), and it is worth doing *after* Phase 3 so the general mechanism informs it.
3. **Topical triggering, measured not assumed.** §5 already says polyness scores 1 against 15 on a three-step prefix. Ship it behind a flag, print the figure, and let it stay unimpressive. A measured weak mechanism is honest; an unmeasured one is a liability.

**Exit:** a rule fires on a real tool call and the transcript shows it; the topical figure is recorded in a test rather than a sentence.

---

## Phase 5 — The trust surface (≈1.5 weeks)

1. **Signing and attestation** (§8): which miner, which version, how many interactions, which thresholds — never the data.
2. **The restricted predicate language** for anything signed, per the Phase 0 decision.
3. **Conflicts between installed bundles surfaced, never silently resolved.** Precedence `own` > `borrowed`, then explicit user ordering, **never recency or install order** (§8). polyx's within-set contradiction detection is the starting point; across bundles is new.
4. **Blocking as a per-bundle local opt-in**, off on install. §8's reasoning is right and worth preserving in the spec text, not just the code: a downloaded rule set that can silently *permit* is worse than one that can deny, because it looks like an approval.

**Exit:** a tampered bundle fails verification; two conflicting bundles produce a reported conflict; blocking cannot be enabled by a bundle about itself.

---

## Phase 6 — polyx as one producer among others (≈1 week)

1. **`polyx export --expertise <corpus>`** — emit a bundle through the *public* format, using the public validator. If polyx needs a private extension to produce a good bundle, the format is wrong and it is cheaper to learn that here.
2. **Only adjudicated rules are exported.** polyx already refuses to serve anything a human has not marked `real`; the same bar applies to anything leaving the building.
3. **The commercial demonstration:** hand-write a bundle, replay it (mostly `neither`), then export the polyx-mined equivalent and replay that (mostly `own`). §9's argument that the free runtime advertises the paid miner is either visible in that comparison or it is not true.

---

## 3. Open problems, and where each is answered

| §10 problem | Where this plan confronts it | Honest status |
|---|---|---|
| **The alphabet travels badly** | Phase 1 (three vocabularies on purpose), Phase 3 (mapping cost + `neither` attribution) | The gate. Unsolved, and the plan is built to find out early rather than late. |
| **Replay needs a local corpus** | Phase 3 item 4 — conformance fixtures, labelled as the author's | Mitigated, not solved. A fixture is a weaker claim and the output must say so. |
| **Recommendations may not survive sharing** | Phase 1 — ship obligations, mark recommendations local-only by default | **This codebase already has evidence for it.** polyx mined 162 recommendation rules from ABCD and **zero** from τ²-bench retail, because τ² trajectories carry no customer facts and no classified intent. Recommendations need a fact base the recipient may simply not have. That is an argument for the default, not a guess. |
| **Naming** | Phase 0 | Cheap now, a migration after publication. |

---

## 4. Risks

| Risk | Effect | Response |
|---|---|---|
| **Vocabulary mapping dominates replay** | The sharing claim fails; the concept reduces to local rules | It is the gate. Measured at Phase 3, on bundles deliberately authored apart. |
| **Anthropic ships this** | Format is commoditised | §9 is right that this is a good outcome and the miner is the value either way. It argues for publishing the spec at Phase 1, which this plan does. |
| **The runtime accretes a polyx dependency** | The free/open claim quietly dies | Structural, CI-enforced, from day one. This is exactly the polyness lesson. |
| **Closures ship across the trust boundary** | An executable-code distribution channel | Phase 0 decision: restricted language in the spec from v0; validator refuses closures in signed bundles. |
| **Hand-written bundles are good enough** | The miner never sells | Do not cripple the runtime. §9's mitigation is correct: `replay` makes an unscored rule set look exactly as untrustworthy as it is, in the tool's own output. |
| **The evaluator diverges from polyx's advisor** | Two implementations of three-valued logic, one of them wrong | Port the tests, not just the code. polyx's abstention test is the single most important test in that system and should be the single most important test in this one. |

---

## 5. What I would not build

- **A registry.** Not until Phase 3 says sharing works. A registry for a format whose sharing story is unproven is infrastructure for a hypothesis.
- **Recommendation sharing.** Local-only by default until there is evidence otherwise (see §3 above).
- **Blocking.** §8 is right; opt-in, after the trust surface exists.
- **A GUI.** The concept's own DevX examples are all CLI and they read well. The one surface worth building is the human review of evidence, and polyx already has it.
