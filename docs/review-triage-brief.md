# Implementation brief — rule triage and the review card

**For the polyx implementation agent. Context: `polyx review abcd`, alphabet v1.**

---

## The problem

Human adjudication is producing unreliable verdicts at ~22s median per rule — far under the 90s target, which means reviewers are reflexing, not deliberating. Two worked examples:

**Rule A** — "when `order.packaging = no` and `slot.membership_level = gold`, update the order", 44/44, no counterexamples. This is almost certainly a re-description of the ABCD subflow: within that flow the agent records shipping status, records membership level, and updates the order every time. The rule restates the script. It rules nothing out.

**Rule B** — "when `order.payment_method = paypal` and `slot.membership_level = gold`, update the order", 38/38, global base rate 29%. Global lift ≈ 3.4, so it survives a naive lift screen — but the two conditions are semantically unrelated, and they are plausibly a fingerprint for a subflow rather than a condition on the action. Additionally `update the order` occurs 1,457 times *without* these conditions, so the conditions cover 2.5% of the action.

**Governing principle for this work:**

> A reviewer must never be asked to reason about something the tool could have queried. Every question a human asks themselves during review that a query could answer is a defect in the card.

---

## 1. Generalise "subflow" to a stratum

ABCD's subflow is a corpus-provided grouping that largely determines the action script. Other corpora have equivalents (τ²-bench task type, BPIC case type). Do not hardcode ABCD.

- Add an optional **stratum** declaration to the alphabet config: which field of an interaction identifies the script/task grouping.
- For ABCD alphabet v1, set it to the subflow label.
- Where no stratum is declared, stratified statistics are reported as unavailable — **not** silently substituted with global ones.

## 2. Statistics to compute per rule

Let `A` = the rule's action, `C` = its antecedent conditions, `S` = the stratum(s) in which the `C ∧ A` instances fall.

| Name | Definition | Purpose |
|---|---|---|
| `support` | P(A \| C) | already computed |
| `coverage` | P(C \| A) = \|C ∧ A\| / \|A\| | **necessity** — how much of the action this rule accounts for |
| `liftGlobal` | P(A \| C) / P(A) | already computed implicitly |
| `liftStratified` | P(A \| C) / P(A \| S) | **the one that matters** — weight by instance count when C spans several strata |
| `outcomeLift` | P(good outcome \| C ∧ A) / P(good outcome \| A) | the outcome figure currently has no comparison class |
| `minimality` | see §3 | is every conjunct load-bearing |

`liftStratified` is the correction. Rule B's 29% → 100% is computed against *all* decision points; the number that decides it is the base rate of `update the order` **within its own subflow**. If that is ~100%, `liftStratified ≈ 1` and the rule carries no information.

## 3. Antecedent minimality

For each proper subset `C' ⊂ C`, compute P(A | C') and the instance count.

- A conjunct `c` is **load-bearing** if removing it drops support by more than `minimalityDelta` (default 0.05, configurable).
- If no conjunct is load-bearing, the conjunction is redundant: suppress the rule and **re-propose the minimal antecedent** as a distinct candidate, linked to the one it replaced.
- If a subset achieves equal support at a *higher* instance count, prefer the subset. More evidence for the same claim.

This answers mechanically what a reviewer was trying to answer by intuition when they said the conjunction "doesn't make sense".

## 4. Triage before the human queue

Screen candidates automatically. Suppression reasons, each with a configurable threshold:

| Reason | Condition | Default |
|---|---|---|
| `stratum-redescription` | `liftStratified` below threshold | < 1.10 |
| `redundant-conjunct` | no conjunct load-bearing (§3) | — |
| `below-floor` | instances under `minInstances` | existing |
| `no-contrast` | zero counterexamples **and** `liftStratified` below threshold | < 1.10 |

**Suppressed rules are never silently dropped.** They are recorded with their reason and their statistics, listed in the audit, and inspectable via `--show-suppressed`. The queue header reports the split:

```
polyx review abcd · alphabet v1
  63 candidates · 38 suppressed (--show-suppressed) · 25 to review
```

Report the suppression-reason distribution in the audit. If one reason dominates, that is a finding about the miner, not about the corpus.

## 5. The review card

### 5.1 Show the full contingency table, not one cell

A reviewer judging whether something is a *rule* reasons about necessity ("only if"), while the card currently shows only sufficiency ("if"). Render both:

```
                      update the order    something else
  conditions hold            38                  0
  conditions don't        1,457              3,679

  sufficiency  P(action | conditions)   100%   (base rate 29%)
  necessity    P(conditions | action)    2.5%
  within subflow                         ...%  ← the number that decides it
```

### 5.2 Every rate carries its comparison class

The action rate already does. The outcome rate does not — "38 of 38 resolved" is meaningless without ABCD's base resolution rate. Apply the same treatment to every figure on the card, without exception.

### 5.3 Evidence: show variance, not repetition

Twenty near-identical traces teach nothing and are the main reason cards take 30 seconds to skim and yield nothing.

- Cluster supporting instances by structural signature (the sequence of non-utterance event types).
- Show **one exemplar per cluster**, with the cluster's size.
- If all instances share one signature, say so in a single line — *"44 instances, structurally identical"* — which is itself the diagnosis, and stop.
- Collapse runs of `utterance` into `… 6 utterances …`.
- **Always show every counterexample**, uncollapsed and unclustered. They are the scarce evidence.

### 5.4 Ask an answerable question

Replace "is this real?" — which is a factual question the tool should mostly have answered — with the normative one only the reviewer can answer:

- Obligations: *"If an agent were about to skip this, would you want it stopped?"*
- Recommendations: *"Would you want an agent to suggest this action in this situation?"*

## 6. Verdicts and reason codes

Add a fourth verdict: **`cant_tell`**.

Ambiguity is currently crushed into real/not-real and the information is destroyed. `cant_tell` is a first-class outcome that routes the rule back to the miner as under-specified, with the reviewer's optional note attached. Track its rate — a high one means the cards are still not answering their own questions.

Optional reason code on any verdict, from a closed list:

`spurious-conjunction` · `stratum-redescription` · `no-mechanism` · `too-narrow` · `already-policy` · `would-not-enforce` · `other` (free text)

`spurious-conjunction` — "these two conditions have no business being related" — is domain knowledge no statistic produces. Feed its frequency back as a signal that antecedent search is over-fitting.

## 7. Review-process telemetry

Record per verdict: elapsed time, verdict, reason code, whether evidence was expanded. Report medians in the audit.

A median under ~30s is evidence that cards are being reflexed rather than read, and should be surfaced as a warning about the *review process*, not treated as good throughput.

---

## Acceptance criteria

1. `liftStratified` is computed and displayed wherever a stratum is declared; explicitly reported as unavailable where one is not. No silent fallback to global lift.
2. Rule A (`e772fd5b865ef265`) is suppressed with reason `stratum-redescription`, or the audit explains with numbers why it is not.
3. Rule B (`b38d4270be3c4aa8`) displays necessity of 2.5% and its within-subflow base rate on the card.
4. Every conjunctive rule reaching the queue has had all proper subsets tested; redundant conjunctions are suppressed and their minimal forms re-proposed.
5. Every rate on every card carries its comparison class.
6. A card whose 20+ supporting instances share one structural signature renders one exemplar and a count, not twenty traces.
7. All counterexamples always render in full.
8. `cant_tell` is selectable, persisted, and routes the rule back as under-specified.
9. Suppressed rules are listed with reasons and statistics under `--show-suppressed`; nothing is dropped without a record.
10. Determinism holds: same corpus + same alphabet version + same thresholds → identical suppression set and identical queue order.
11. All new thresholds live alongside the existing ones, are reported in the audit header, and are not tuned to this corpus without a note saying so.

## Out of scope

Do not change the mining patterns, the provenance lattice, or the alphabet in this pass. This is triage and presentation only. If the statistics suggest the pattern table is generating too many trivial candidates, report it — do not fix it here.
