# polyx — literature review and positioning

*Mining an expert system out of AI agent logs.*
Prepared 29 August 2026. Sources are linked inline; §9 marks which were read in full and which were only surfaced.

---

## 1. The claim, stated so it can be checked

polyx proposes that an **expert system can be mined from the logs an agent already writes**, and that the resulting rule base then assists the agent — recommending, constraining, and eventually short-circuiting inference for work the agent has done before.

Two halves, and the literature treats them very differently:

| | Half | Maturity |
|---|---|---|
| **Induction** | logs → symbolic rules with measured support | active, fragmented across four communities that rarely cite each other |
| **Enforcement** | rules → a runtime that gates or advises the agent | newly formalised (2026), and the formal results are *restrictive* in a useful way |

The honest name for the whole loop is old: this is a **learning apprentice** — a system that acquires its knowledge base by watching an expert work, rather than by interviewing one. That framing was developed in the late 1980s and early 1990s explicitly as the attack on the *knowledge-acquisition bottleneck*, the reason classical expert systems died ([Wilkins-style apprentice knowledge acquisition](https://www.sciencedirect.com/science/article/abs/pii/000437029390059K); [KB refinement via apprenticeship learning](https://link.springer.com/chapter/10.1007/BFb0017226)). The bottleneck was never that rules are a bad representation. It was that a human had to write them, and nobody could keep them current.

**What is new in 2026 is not the idea. It is the corpus.** An agent harness emits a complete, timestamped, machine-readable record of expert work at a volume no 1990s apprentice system ever had — polyness reports 4,909 tool calls in 12 sessions on *one* project. The bottleneck moved from acquisition to *justification*: which of the millions of regularities in that log are rules, and which are coincidence.

That is the question polyness already answers, and it is the reason polyness is the right pillar.

---

## 2. Stream A — experience → artifact, the incumbent approach (and the one polyx is arguing against)

This is the dominant line and the one your framing is a direct critique of. Agents distil their own past into **natural-language artifacts** — insights, skills, memory files, playbooks — which are then re-injected into the prompt.

- **ExpeL** ([arXiv 2308.10144](https://arxiv.org/html/2308.10144v2), AAAI 2024) is the canonical reference. It builds an experience pool, compares success/failure pairs, and maintains a set of NL *insights* under four operations: `ADD`, `EDIT`, `UPVOTE`, `DOWNVOTE`, with an importance count; an insight whose count reaches zero is removed. Note how close that is in *spirit* to polyness's `replay` — and how far in rigour: the vote is another LLM's opinion, not a re-scoring against the corpus.
- **Agent Workflow Memory** ([arXiv 2409.07429](https://arxiv.org/html/2409.07429), ICML 2025) induces reusable *workflows* — "a goal with a common routine extracted from available action trajectories" — offline from annotated traces and online from self-generated, evaluator-validated ones. +51.1% relative success on WebArena. This is the closest published analogue to `polyness propose`, except that the workflow is an NL sub-routine rather than a checked machine, and induction is by LLM abstraction rather than by measured support.
- **PILOT** ([arXiv 2608.26530](https://arxiv.org/abs/2608.26530), 25 Aug 2026 — the paper you sent) pushes this loop *live*: a supervisor process watches a worker mid-run, can steer or abort it, and distils procedures and failure modes into skills and memory **during** execution rather than post-hoc. Verifier outcomes are used only to decide which of a round's updates survive into the next round, never to author them. Results: +14.6 pp on Terminal-Bench 2.0 over 20 iterations, 42.9% fewer output tokens, and a skill library that grows by 21–31 skills.

**Verdict on the PDF you sent: yes, relevant — and more useful as an antagonist than as an ancestor.** It is the strongest current statement of the thing you called unreliable, and it is worth reading for three specific things:

1. **Its evaluation protocol is directly reusable by polyx.** Freeze a backbone; organise tasks into iterations sharing a harness state; let the system write artifacts during runs; use the verifier *only* to decide which artifacts carry forward. Swap "skills and memory" for "mined rules" and you have a clean A/B against the incumbent on the same axis. Its efficiency metric — *successful evaluations per million output tokens* — is exactly the number an expert system should move, because a fired rule is inference you did not pay for.
2. **Its architecture — a separate supervisor with its own context, watching a live trajectory — is the natural place a polyx rule engine plugs in.** PILOT's supervisor is an LLM judging a stream. Replace or augment that judgement with a rule base evaluated over the same stream and you get PILOT's timeliness at a fraction of its cost, with an audit trail.
3. **Its skill library is unfalsifiable in the way your critique predicts.** Skills are retained if the run that produced them passed. That is a *correlational* filter — the skill rode along with a success — not evidence the skill did anything. polyness's distinction between own / borrowed / neither evidence, and its willingness to report that 26 of 31 projects have nothing to say, is precisely the discipline this literature lacks.

**The failure mode is now documented, not just suspected.** See the SSGM framework on governing evolving memory ([arXiv 2603.11768](https://arxiv.org/abs/2603.11768)) — risks of unbounded self-written memory, and mechanisms for stability and safety — and **VerificAgent** ([arXiv 2506.02539](https://arxiv.org/html/2506.02539v3)), which adds domain-specific human verification of accumulated memory for computer-use agents. Both concede the same point: **an artifact written in natural language into a prompt cannot be checked against anything.** Your README says it in one line — *"a rule in a prompt or a memory file cannot be checked against anything; a rule that is a predicate over a path can"* — and that line is, as far as this search found, the sharpest available statement of the gap.

---

## 3. Stream B — symbolic rule induction from traces

This is polyx's actual technical family, and it is thinner than Stream A but far more rigorous.

- **AutoSpec** ([arXiv 2606.24245](https://arxiv.org/abs/2606.24245), June 2026) is the closest published relative to what you are proposing, and you should read it first. It evolves *safety rules* for LLM agents using counterexample-guided inductive synthesis (CEGIS) coupled with inductive logic programming: evaluate the current rule set, harvest false positives and false negatives from annotated execution traces, use ILP to find predicates that "appear frequently in false negatives but rarely in false positives", propose rule edits, validate. On 291 traces across code-execution and embodied domains it reaches F1 0.98 / 0.93, cuts false positives by up to 94% at high recall, converges in 4–5 iterations, and beats heuristic CEGIS by 4.8× F1.

  **Where it differs from polyx, and where polyx is stronger:** AutoSpec *refines expert-authored seed rules* against *annotated* traces. It needs both a human-written starting point and labels. polyness's position — rules are synthesised from a fixed pattern table, support is measured, and provenance decides whether a rule may be *proposed* at all — needs neither. AutoSpec's counterexample loop is, however, exactly the machinery polyx will need for the *second* iteration, once the polyflow gate starts producing overridden denials. Your README already names that signal: *"a denial you override is a labelled false positive, and it is the only observation in the system that can tell a rule it is wrong."* That is AutoSpec's input, generated for free by enforcement.

  **No corpus was released** (checked v3, 7 July 2026): no code, data, artifact, or reproducibility statement anywhere in the paper or its arXiv metadata. The 291 traces are, however, *re-derivable* — 91 unsafe code traces sampled from **RedCode-Exec** (25 risk categories, ≤4 per category), 100 safe code traces synthesised with GPT-5.1-Codex to mirror the unsafe categories without tripping the predicates, and 100 embodied traces (52% unsafe, 1–15 events, mean 5.1) from **SafeAgentBench**; the implementation is 12K lines of Python 3.10 built on AgentSpec's public predicate library. So the pipeline is reproducible in principle and the exact numbers are not.
  **This is a gap, and it is polyx-shaped.** There is no public, annotated corpus of agent traces for rule mining. Every result in this stream is measured on a corpus nobody else can see — which is also true of polyness, where `test/baseline.json` is gitignored on purpose, though for the opposite reason (it names private directories rather than withholding a benchmark). A shareable trace corpus with labelled outcomes would be a contribution independent of any mining method, and the simulated banking CRM is a domain where one can be *generated* rather than harvested.

- **Learning compositional symbolic task rules from demonstrations with ILP** ([arXiv 2605.26828](https://arxiv.org/html/2605.26828)) — rules from demonstration traces in a robotics setting; relevant for the compositional structure of multi-step rules.
- **Online inductive learning from answer sets** ([arXiv 2501.07445](https://arxiv.org/html/2501.07445v1)) — incremental ILP under ASP, the shape polyx needs if mining is to run continuously rather than as a batch audit.
- **Inductive logic programming at 30** ([Machine Learning, 2021](https://link.springer.com/article/10.1007/s10994-021-06089-1)) — the field survey; read for the noise-tolerance and scalability limits, which are the real constraint on log-scale mining.
- **NeuSymMS**, a hybrid neuro-symbolic memory system for LLM agents ([arXiv 2605.17596](https://arxiv.org/html/2605.17596v2)), sits between Streams A and B and is worth a skim for the memory-representation question.

---

## 4. Stream C — process mining, and its two directly transferable results

Twenty years of work on "given an event log, what process produced it". Two sub-fields matter to polyx.

**Declarative process discovery** is the closest formal match to polyness's rule shapes. Instead of discovering a flowchart, it discovers a set of **constraints** over activities — `response(a,b)`, `precedence(a,b)`, `alternate_response`, `absence`, `existence` — from the DECLARE language, each with measured *support* and *confidence* over the log. See [MINERful](https://www.diciccio.net/claudio/preprints/DiCiccio-etal-BPMDemos2015-DeclarativeProcessDiscovery.pdf), the [Di Ciccio & Montali handbook chapter](https://www.inf.unibz.it/~montali/papers/diciccio-montali-PMBook2022-declarative-mining.pdf) on reasoning/discovery/monitoring, and [data-aware Declare discovery](https://kodu.ut.ee/~dumas/pubs/bpm2013DeclarativeProcessMining.pdf) for adding data conditions to constraints.

**This is worth internalising, because polyness's four patterns are DECLARE templates under different names:**

| polyness pattern | DECLARE template |
|---|---|
| `no-X-without-a-prior-verify` | `precedence(verify, X)` |
| `X-implies-a-prior-Y` | `precedence(Y, X)` |
| `at-most-one-X-per-run` | `absence2(X)` |
| `exactly-one-Y-per-X-run` | `co-existence` + `absence2(Y)` |

That is a strong result for the project, not a threat. It means the pattern table has a 15-year-old formal semantics behind it, a body of work on efficient discovery at scale, on the redundancy/subsumption problem (which constraints imply which — directly relevant to your `maxGuardRules: 3` cap), and on *branched* and *data-aware* extensions ([recent work on branched declarative constraints](https://link.springer.com/chapter/10.1007/978-3-032-02929-4_9)). It also means the polyx paper should cite it rather than reinvent it — and that the defensible novelty is elsewhere (§6).

**Robotic process mining / task mining** is the other half: discovering automatable routines from low-level UI interaction logs — segmentation of a noisy event stream into tasks, then discovery of the repeated routine ([Discovering automatable routines from user interaction logs](https://lepo.it.da.ut.ee/~dumas/pubs/rpadiscovery.pdf); [Robotic Process Mining: Vision and Challenges](https://link.springer.com/article/10.1007/s12599-020-00641-4); [data-transfer routine discovery](https://www.sciencedirect.com/science/article/abs/pii/S0306437921001241)). Their hardest problem is *segmentation* — where does one task end and the next begin — which is precisely polyness's `episodes.mjs` ("a session is not a task") and its run/session window distinction. This literature has been at it since 2019 and is worth mining for technique.

**Agentic process mining** is the 2026 frontier and is currently pointed the *opposite* way from polyx: using LLM agents to *do* process mining ([PMAx](https://arxiv.org/html/2603.15351), [PM4Py-UCM](https://arxiv.org/html/2607.28825), [process-aware LLM agent architecture](https://www.sciencedirect.com/science/article/pii/S0306437926000621)). Nobody in that community appears to be mining the agent's *own* logs to govern the agent. That gap is real and it is yours.

---

## 5. Stream D — enforcement, and a formal result you should design around

- **AgentSpec** ([ICSE 2026](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf)) is the runtime side of polyflow's gate, independently invented. Its DSL is *trigger → predicate → enforcement action*, where enforcement is one of `user_inspection`, `llm_self_examine`, `invoke_action`, `stop`. Hand-written rules block >90% of unsafe code executions and 100% of unsafe embodied actions; LLM-*generated* rules do measurably worse (87.3% detection on code; 95.6% precision / **71.0% recall** on embodied). Overhead is ~1–3 ms per predicate. **The paper explicitly does not mine rules from logs.** That is the sentence to quote in polyx's related work: the enforcement machinery exists, the rules are still hand-written or LLM-guessed, and the recall gap between the two is the space polyx occupies.

- **"What can be enforced? A theory of certified runtime safety for tool-using agents"** ([arXiv 2607.22868](https://arxiv.org/html/2607.22868), July 2026) is the most important paper in this list for *design*, because it tells you what a gate can never do:
  - A pre-execution gate enforces exactly the policies whose good prefixes are recognisable by a **keyed-counter register automaton** over fixed oracle predicates — *strictly weaker* than edit automata, because a gate cannot buffer and reinsert.
  - **Only safety properties** (those with finite bad prefixes) are runtime-enforceable. Liveness — "the agent eventually verifies" — is not.
  - Soundness + transparency (compliant traces are never altered) is the right definition of effective enforcement.
  - Offline ROC curves **do not** predict closed-loop performance once the gate changes agent behaviour; you need a controlled-POMDP formulation.
  - Nontriviality of a policy is undecidable with two decrementable counters, decidable in PSPACE for a separable monotone fragment covering caps and revocations.

  Three consequences for polyx, stated plainly. **(a)** `path.count(...) <= 1` and `path.actionBefore(...)` are inside the enforceable fragment — the predicate vocabulary is already the right shape, which is a lucky and defensible choice. **(b)** polyness's insistence that every rule declare the *window* its support was measured over is the empirical face of the same distinction: a session-window fact is not a run-enforceable property. **(c)** The moment the gate starts denying, your measured support figures stop describing the world the gate now sees. This is the paper's closed-loop warning, and it is a live risk for `replay`: a corpus collected under enforcement is not the corpus the rule was mined from.

- Adjacent: [Learning efficient guardrails for compliance](https://arxiv.org/html/2510.03485), [Policy-as-Prompt](https://arxiv.org/pdf/2509.23994) (governance documents → guardrails — the *top-down* counterpart to polyx's bottom-up mining; a real polyx deployment in banking will need both directions to meet).

---

## 6. Where polyness already sits, and what is actually novel

Five ideas in polyness are load-bearing and generalise beyond the dev-tool domain. Stated as claims polyx can defend:

1. **Mine consequential events, not sequences.** §1.1's measurement — an identical 3–4 step window recurs in 3% of projects, a consequential event in 47%, and misbehaves in 22% — is the design decision that makes the whole thing tractable, and it is an *empirical* argument, not an aesthetic one. Robotic process mining has spent years on sequence discovery and hit exactly this wall. This finding is publishable on its own.
2. **Provenance gates the normative act.** `own` / `borrowed` / `neither`, with the rule that a proposal requires own evidence while *scoring* is unrestricted. No system in Streams A–D makes this distinction. ExpeL's votes, AWM's induction, and PILOT's skill retention all import opinion as finding. This is the single sharpest differentiator.
3. **Silence is a reported result.** 26 of 31 projects with nothing to propose, said in those words. Declarative discovery is notorious for emitting hundreds of true, useless constraints; the DECLARE community handles this with redundancy pruning, polyness handles it with a consequence filter and a support floor.
4. **Every number is traceable to journal records in one command.** §1.3's anecdote — one regex change moving a project from "7 pushes, 0 verified" to "14 pushes, 12 verified" — is the strongest argument in the README, and it generalises: **the alphabet is the experiment.** In a CRM domain the alphabet is contestable in a way `git push` is not, which makes `--show` and `corrections.mjs` *more* important there, not less.
5. **A rule can be retired.** `replay` re-scores an adopted rule and notices staleness. Nobody deletes a line from a memory file; that is why they rot. This connects to a real ML literature on rule-base drift ([rule-based drift analysis](https://arxiv.org/html/2602.03489); [concept drift in rule-based classifiers](https://arxiv.org/html/2604.22629)).

**The defensible novelty of polyx**, then, is not "mine rules from logs" (process mining), nor "constrain an agent at runtime" (AgentSpec), nor "learn from experience" (ExpeL/AWM/PILOT). It is:

> **A closed loop in which the rules an agent is governed by are (i) synthesised only from that operator's own measured history, (ii) expressed in a predicate vocabulary inside the runtime-enforceable fragment, (iii) enforced by a gate whose overrides are the labelled counterexamples that retire them.**

Each of the three exists separately. Nothing in this search does all three, and the third clause is what turns the system from a static rule base into an expert system that keeps its own accounts.

---

## 7. Transferring to a banking CRM agent — what changes, honestly

Your CRM example is a much harder domain than the dev-tool one, and the difficulty is worth naming before building.

**What breaks:**

| Dev-tool corpus | CRM corpus |
|---|---|
| `CONSEQUENTIAL` is a closed, obvious set (`git push`, `npm publish`) | consequence is graded and contested: *recommend a product* vs *open an account* vs *waive a fee* |
| Outcome is available in-band and immediate (exit code) | outcome is delayed, external and often absent (did the customer take the product? churn at 90 days?) |
| The "expert" is the same person as the operator | the expert is a population of agents and human reps of uneven quality; majority behaviour may encode a *bad* norm |
| A wrong rule wastes a run | a wrong rule is a mis-sold financial product, and regulators ask who wrote it |
| Alphabet is the shell command | alphabet must be built from intents, entities and outcomes — `corrections.mjs` becomes the biggest module in the system |

**What gets better:**

- The event log is already normative territory. Banking runs on documented, auditable decision rules (suitability, KYC, disclosure, affordability). A mined rule that *reproduces* a policy the bank already has is a validation signal, and a mined rule that *contradicts* one is a compliance finding — a product with immediate value independent of any agent-assist story.
- Ground-truth outcome labels genuinely exist, just late: acceptance, activation, complaint, churn, chargeback. That converts polyness's `outcome: passed|failed` classification from a heuristic into a supervised signal, and makes the AutoSpec counterexample loop viable.
- The prize is legible. **Next-best-action** in banking is a mature commercial category that today is either hand-authored rules or an opaque model ([next-best-action marketing](https://en.wikipedia.org/wiki/Next-best-action_marketing); the [survey of LLM-powered agents for recommender systems](https://aclanthology.org/2025.findings-emnlp.620.pdf); [Think Then Recommend, WWW 2026](https://dl.acm.org/doi/10.1145/3774904.3793050)). "Rules mined from your own reps' history, each traceable to the interactions that support it, each retirable" is a sentence a bank's model-risk function can act on and a neural recommender cannot offer.

**Two rule families the CRM domain needs that the dev domain did not:**

- **Recommendation rules** (`if customer_state ∧ context → offer P`) — these are classifier-shaped, not constraint-shaped, and pull in the interpretable rule-learning literature: RIPPER-family decision lists, [Bayesian rule sets](https://jmlr.org/papers/volume18/16-003/16-003.pdf), [submodular decision rule sets](https://proceedings.neurips.cc/paper/2021/file/eaa32c96f620053cf442ad32258076b9-Paper.pdf), [interpretable ML ch.10](https://christophm.github.io/interpretable-ml-book/rules.html), and — attractive here — [evidential rule learning **with abstention**](https://arxiv.org/html/2608.05859v1), which lets a rule base decline to fire and hand back to inference. That abstention semantics is exactly the polyx architecture: the expert system covers what it has evidence for, the LLM covers the rest, and coverage grows over time as a measurable quantity.
- **Obligation rules** (`never quote a rate without a disclosure`) — these are DECLARE/AgentSpec-shaped and go straight to the gate.

Keeping those two families formally separate, with different evidence standards, is probably the right architectural call: **the gate may only enforce obligations; recommendations are advisory and always abstainable.**

**Case-based reasoning** deserves a look as the fallback layer for the long tail where rules cannot reach ([Review of CBR for LLM agents](https://arxiv.org/abs/2504.06943)) — retrieve the closest prior interaction rather than fire a rule. CBR was the other 1990s answer to the knowledge-acquisition bottleneck, and a three-layer stack (rules → cases → inference) has a coherent story.

---

## 8. Open questions worth deciding early

1. **Corpus feedback.** Once the gate denies, the log is generated under enforcement. How is support re-measured without circularity? (The certified-enforcement paper's closed-loop warning; the honest answer may be a held-out unenforced arm.)
2. **Thresholds.** `THRESHOLDS` is currently one corpus's numbers, pinned by a test against that same corpus, and the code says so. A second domain is the only cure; the CRM pilot is that second domain.
3. **Where does the LLM belong in the mining loop?** polyness deliberately keeps it out — the patterns are a fixed table. AutoSpec and AWM put it in. Keeping it out is defensible and rare; the cost is that the pattern table must be extended by hand per domain. A middle position — LLM proposes candidate predicates, measurement decides — is probably where polyx lands, and it should be an explicit decision rather than a drift.
4. **Log portability.** polyness reads Claude Code journals only. The [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/blog/2025/ai-agent-observability/) are consolidating agent traces into a standard shape; targeting them makes the reader interface real rather than aspirational, and makes a CRM harness ingestible without a new parser.
5. **Population vs. individual evidence.** `own` evidence assumes one operator whose history is authoritative. In a CRM, "own" could mean this rep, this team, this bank, or this regulator — a four-level provenance lattice rather than three. Worth designing before the pilot, not after.
6. **What does the expert system actually save?** PILOT's metric — successful outcomes per million output tokens — is the right one. A rule that fires is inference not performed; that is the number that makes the business case, and it should be instrumented from day one.

---

## 9. Data strategy — what is public, what must be made

**Finding: you do not need a synthetic corpus to start, and building one first would be a mistake.** Public data splits into four buckets, none complete, but two of them carry something worth more than volume — **a published ground-truth rule set** that mined rules can be scored against.

### 9.1 Traces *with* a known policy — the bucket that matters

| Dataset | What it gives | Why it matters to polyx |
|---|---|---|
| **ABCD** ([NAACL 2021](https://aclanthology.org/2021.naacl-main.239/), [repo](https://github.com/asappresearch/abcd)) | 10K+ human–human customer-service dialogues, 55 intents; turns typed `agent` / `customer` / **`action`** (30 button actions, 125 slot values); `ontology.json` for flows/subflows | ships **`data/guidelines.json`** — the machine-readable version of the *actual agent guidelines the human reps were following*. A log of expert work **with the rule book attached.** |
| **τ²-bench** ([Sierra, MIT](https://github.com/sierra-research/tau2-bench), [paper](https://arxiv.org/pdf/2406.12045)) | domains `retail`, `airline`, `telecom`, `mock`, **`banking_knowledge`**; each ships a policy document the agent must obey, plus tools and a DB | trajectories are **generated, not shipped** — run it and get unlimited traces under a known policy with zero data-governance cost |
| **CRMArena-Pro** ([paper](https://arxiv.org/pdf/2505.18878), [HF](https://huggingface.co/datasets/Salesforce/CRMArenaPro)) | 19 tasks over synthetic B2B (29,101 records) / B2C (54,569) Salesforce orgs; skills include **Workflow Execution** and **Policy Compliance** | its headline negative result — "all evaluated models demonstrate near-zero confidentiality awareness" — is a ready-made argument for a rule layer |

### 9.2 The other three buckets

- **Real bank process logs, no agent.** [BPIC 2012 / 2017](https://data.4tu.nl/articles/dataset/BPI_Challenge_2017_-_Offer_log/12705737) — real loan-application event logs from a Dutch financial institution, the canonical process-mining corpora, with genuine outcomes (accepted / declined / cancelled). Real consequential events at scale; no dialogue, no agent.
- **Banking outcomes, no process.** [Santander Product Recommendation](https://www.kaggle.com/c/santander-product-recommendation) — per-customer, per-month product holdings over time, i.e. next-best-product ground truth; UCI Bank Marketing for campaign outcomes.
- **Agent traces at volume, no domain policy.** [AgentBank](https://aclanthology.org/2024.findings-emnlp.116/) (50K+ trajectories), [AgentTrek](https://agenttrek.github.io/), [Open-SWE-Traces](https://arxiv.org/html/2606.16038), and — separately important — the [**Agent Data Protocol**](https://arxiv.org/html/2510.24702v2): 13 datasets and 1.3M trajectories unified under one released Pydantic schema (actions: API / code / message; observations: text / web), with converters for OpenHands, SWE-Agent and AgentLab. **ADP is a better near-term target for polyness's reader interface than the OTel GenAI conventions**, because the data already exists in it.

### 9.3 The evaluation nobody has run

No public dataset has all four of: agent traces, consequential actions, delayed real outcomes, and a published rule book. But ABCD and τ²-bench supply the fourth, and that unlocks a method the AutoSpec / AgentSpec line has not used:

> **Mine rules from the traces, then score them for precision and recall against the policy document the operators were actually following.**

This is falsifiable, runs on public data, and is reproducible by a reviewer — which is precisely what AutoSpec's unreleased corpus is not (§3). It also tests polyness's central claim in both directions: does own-evidence mining **recover** the real policy, and does it correctly **refuse** to propose rules the policy does not contain? A false-positive rate measured against a real rule book is a stronger result than any F1 on self-annotated traces.

### 9.4 Sequencing

1. **Phase 0 — public, no partner needed.** τ²-bench (`retail`, `telecom`, then `banking_knowledge`) plus ABCD. Recover a known rule set; report precision/recall and refusals. This is simultaneously the validation, the paper, and the demo.
2. **Phase 1 — partner, but not for data.** See §9.5.
3. **Phase 2 — synthetic generator**, specified with the partner and seeded by their policy corpus rather than their customers.

### 9.5 What to ask a bank partner for (it is not data)

Four things, all cheaper for the bank to give than customer records, and all worth more:

1. **The policy corpus** — rep-facing procedure docs, decision matrices, disclosure and suitability requirements. This is the ground truth, and it usually contains no customer data, so it clears legal far faster.
2. **An action taxonomy** — which actions are consequential, and which are irreversible. In polyness terms: help populating `CONSEQUENTIAL` and `corrections.mjs`. An hour of a domain expert's time on the module that decides whether every number downstream is right (§1.3).
3. **An outcome definition** — what counts as a good interaction at 90 days.
4. **Adjudication** — an expert who will review ~50 mined rules and mark which are real. That is a labelled counterexample set, i.e. exactly AutoSpec's missing input, obtained in an afternoon.

**The month-one deliverable is not agent assist. It is policy archaeology.** Mine rules from what reps actually do; diff against the written policy. Three findings fall out immediately: rules **followed but not written** (tribal knowledge worth capturing), rules **written but not followed** (a compliance gap), and rules that **contradict each other**. That is something a head of digital transformation can take to a risk committee before any agent is deployed — and it is what polyness already does, since `own` / `borrowed` / `neither` is a policy-conformance verdict under another name.

### 9.6 Reuse across partners — settle the IP before the corpus exists

A synthetic corpus generated from one bank's policy encoding is arguably derivative of that bank's confidential material even when it contains no customer data. Split it three ways *in advance*:

- **generator, schema, mining code** — yours, always, non-negotiable;
- **partner-specific policy encoding and any corpus generated from it** — theirs or joint, with a non-exclusive licence back to you;
- **a de-identified reference corpus** built from a *generic* retail/commercial banking policy model, derived from public regulatory material (Reg B, Reg Z, FDIC/OCC guidance) and τ²-bench's structure — **yours to publish and reuse.**

The third is the one you actually want, and it is far easier to agree before an engagement than after. Note also that the *rules* will not transfer between a US bank and an Australian one — different regulatory regimes — so the reusable asset across partners is the **generator and the method**, not the corpus. Sell it that way.

---

## 10. Reading list, in order

**Read in full for this brief:** AutoSpec; AgentSpec; What Can Be Enforced?; Agent Workflow Memory; ExpeL; PILOT (your PDF).
**Surfaced and skimmed, worth a full read next:** MINERful / Di Ciccio & Montali declarative discovery; Discovering Automatable Routines from User Interaction Logs; SSGM; VerificAgent; evidential rule learning with abstention; CBR for LLM agents review.

| # | Work | Why |
|---|---|---|
| 1 | [AutoSpec (2606.24245)](https://arxiv.org/abs/2606.24245) | closest published relative; CEGIS+ILP over agent traces |
| 2 | [What Can Be Enforced? (2607.22868)](https://arxiv.org/html/2607.22868) | the formal limits your gate lives inside |
| 3 | [AgentSpec (ICSE 26)](https://cposkitt.github.io/files/publications/agentspec_llm_enforcement_icse26.pdf) | the enforcement DSL; explicitly does not mine |
| 4 | [Di Ciccio & Montali, declarative process specs](https://www.inf.unibz.it/~montali/papers/diciccio-montali-PMBook2022-declarative-mining.pdf) | the formal semantics your four patterns already have |
| 5 | [Discovering automatable routines from UI logs](https://lepo.it.da.ut.ee/~dumas/pubs/rpadiscovery.pdf) | segmentation, the problem `episodes.mjs` solves |
| 6 | [Agent Workflow Memory (2409.07429)](https://arxiv.org/html/2409.07429) | the NL analogue of `propose` |
| 7 | [ExpeL (2308.10144)](https://arxiv.org/html/2308.10144v2) | the NL analogue of `replay` |
| 8 | [PILOT (2608.26530)](https://arxiv.org/abs/2608.26530) | the live loop; the evaluation protocol to copy |
| 9 | [SSGM (2603.11768)](https://arxiv.org/abs/2603.11768) | documented failure modes of self-written memory |
| 10 | [Evidential rule learning with abstention (2608.05859)](https://arxiv.org/html/2608.05859v1) | how a rule base declines to fire — the polyx/LLM handoff |
| 11 | [Robotic Process Mining: vision & challenges](https://link.springer.com/article/10.1007/s12599-020-00641-4) | the field that already hit your §1.1 wall |
| 12 | [CBR for LLM agents review (2504.06943)](https://arxiv.org/abs/2504.06943) | the long-tail layer under the rules |
