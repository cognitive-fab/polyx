# The runtime gap, and the half of it nobody is selling against

*7 September 2026 · polyx*

A vendor post has been circulating that frames the agent security problem well:
the fastest-growing attack surface is the ecosystem of MCP servers, skills,
plugins and connectors that agents depend on; those components are already on
your developers' endpoints; and every incident happens *past the inference
boundary*, at runtime, where most tooling has no reach.

That framing is right, and it now has numbers behind it. But it contains a
distinction the post makes in one paragraph and then drops — and that paragraph
is the larger half of the problem, the half no security vendor is really selling
against, because it is not a security problem in the shape their tools expect.

---

## 1. The claims check out

Worth stating plainly, because a lot of agent-security writing does not survive
a fact check:

- **The NSA guidance is real.** *Model Context Protocol (MCP): Security Design
  Considerations for AI-Driven Automation*, a 17-page Cybersecurity Information
  Sheet published 20 May 2026 (U/OO/6030316-26). Its framing is that MCP's
  adoption outpaced its safeguards, and it names uncontrolled automated actions,
  absent input screening, trust-boundary failures and agent misuse. Its
  recommendations are execution-layer: sandboxing, output filtering, message
  integrity, local MCP scans, and governance of third-party integrations.
- **The supply-chain incidents are real and recent.** The `postmark-mcp`
  package-squatting attack (September 2025); the Clawdbot exposure (January
  2026) in which 2,000+ MCP instances leaked credentials and conversation
  history through unauthenticated gateways; GitHub MCP prompt injection via
  malicious issues; and CVE-2026-33032 (CVSS 9.8), a supply-chain compromise
  that silently BCC'd mail from a reported 437,000+ environments.
- **The skill registries are being poisoned at scale.** Snyk's *ToxicSkills*
  study found prompt injection in 36% of a sampled registry and 1,467 malicious
  payloads; one campaign pushed 1,184 malicious skills across 12 publisher
  accounts, and at peak five of the seven most-downloaded skills were malware.
  Across eight scanners and 1,600+ real malicious skills, disguised versions
  passed almost every time. OWASP formalised an **Agentic Skills Top 10** in
  March 2026.

So: not hype. The adversarial surface is real, growing, and under-defended.

---

## 2. The distinction that matters

The post mentions, almost in passing, "another category worth paying attention
to: agents causing real damage with no attacker involved."

That category is **the majority of the incidents**.

Cyera reviewed 7,246 publicly reported AI incidents from September 2023 to May
2026 and verified 344 as enterprise-relevant. In **188 of the 344 — 55% — an
autonomous AI system caused harm directly in production with no attacker
anywhere in the chain.** The curve turns sharply in December 2025, coinciding
with enterprise deployment of autonomous coding agents: 27 cases in the eleven
months to November 2025, then a jump.

Of the 137 real-world damage cases they categorise:

| category | incidents |
|---|---|
| deletion and code destruction | 65 |
| service and physical disruption | 30 |
| hidden integrity failure | 23 |
| financial harm | 19 |

And the pattern in the severe half: **"a coding agent had shell or repository
access and ran without a confirmation step on destructive commands."**

The canonical case is PocketOS, April 2026: a Cursor agent erased a car-rental
SaaS platform's production database *and its volume-level backups* in nine
seconds. No exploit. No injection. No malicious code. The agent authenticated
normally, called a valid endpoint, and executed a permitted operation. Three
months of customer data, nothing to restore from.

---

## 3. Why security tooling cannot see this

Every control in the adversarial column assumes something to detect: an
untrusted component, a poisoned description, an anomalous destination, a
credential leaving. Scanners, gateways, egress filters and provenance checks all
work on that assumption.

The PocketOS agent tripped none of it, and could not have. **Authenticated
identity, valid endpoint, authorised operation.** There was no attacker to find
and no anomaly to flag. The action was permitted; it was simply wrong.

That is the gap in one sentence:

> **A permission system answers "may this actor do this?" It cannot answer
> "should this action happen here, given what has already happened in this
> session?"**

The first is access control and we have fifty years of it. The second is a
*precondition* — an obligation over a sequence — and almost nothing enforces it.
"Never push without a passing verification." "Never delete without a prior
status check." "Never modify the default address without looking up the order."
Neither an IAM policy nor a firewall can state those, because they are not
properties of an actor or a destination. They are properties of an ordering.

---

## 4. Where the field is converging, and what it admits it hasn't solved

Independently, three lines of work land in the same place: **synchronous,
deterministic authorization at the tool-call boundary, before the effect.**

- Cyera's five recommended controls, ranked by frequency in their data, open
  with *gate irreversible actions* and *move controls into the execution layer*.
- The NSA's recommendations are execution-layer for the same reason.
- The *Open Agent Passport* paper (arXiv 2603.20953) specifies a `before_tool_call`
  hook returning ALLOW / DENY / ESCALATE with signed audit records. Its adversarial
  testbed is striking: 4,437 authorization decisions across 1,151 sessions against
  live attackers, where a permissive policy tier saw a **74.6% social-engineering
  success rate** and the restrictive tier saw **0% across 879 attempts**, with a
  $5,000 bounty unclaimed. Their conclusion is the one that matters: *"the model's
  judgment was overridden through adversarial conversation; the deterministic
  policy evaluation was not."*

Determinism at the boundary is the right primitive. The mechanism is settled.

What is not settled is stated candidly in that paper's own limitations, and two
of them are the whole problem:

> **"Adaptive policies: static policies require manual updates; learned policies
> remain future work."**
>
> **"Composability attacks: independent per-call evaluation misses sequence-based
> structuring attacks."**

Which is to say: the gate works, and nobody knows where the rules come from, or
how to express a rule about an *ordering* rather than a call.

---

## 5. The unexamined assumption: that written rules are followed

Everything above assumes an organisation can write down what its agents must do,
and that written rules describe behaviour. We measured that assumption on a real
corpus — 141 Claude Code sessions, 34 projects, ~112,000 typed events, mined
without a model call so the result is reproducible byte-for-byte — and it does
not hold.

**One written instruction in force for every one of those sessions was followed
0 times out of 299 opportunities.** The skill it belongs to says *"always invoke
this skill BEFORE attempting to use any of these tools."* It was never once
invoked first.

The honest reading is more interesting than defiance. A *competing* written
rule — the harness's own instruction to load those tools a different way —
was followed, and confirmed by the same analysis at 9 of 9, 12 of 12 and 5 of 5
in three separate projects. **Two written rules governed the same action, and
the behaviour picked one.** Nobody knew, because nobody was counting.

A second measurement, same corpus: of eight quotable "load X before doing Y"
instructions, only **three could be stated as a checkable precondition at all**.
The other five depend on intent, on an argument's value, or on what a file
contains. Of the three checkable ones: one confirmed, one dead, one governing.

Two consequences follow, and they are the post's real argument:

1. **A guardrail nobody measures is not a control, it is a document.** Written
   agent policy rots exactly the way security policy rots, and for the same
   reason: nothing ever deletes a line because the line stopped being true.
2. **Most of what an organisation writes down is not enforceable as a
   precondition.** Any honest gate has to say which fraction it can check — and
   report the rest rather than quietly dropping it.

---

## 6. What actually closes the loop

If the mechanism is a deterministic gate before the effect, and the open problem
is where its rules come from, then the missing piece is not another policy
language. It is a way to derive the preconditions from what the organisation
already does, and to keep them honest as behaviour changes.

That is buildable today, and the parts are unglamorous:

- **Type the actions.** Every consequential thing an agent does, with a declared
  consequence — none, compensable, irreversible. This is judgement work and it
  does not automate; it is also the entire cost.
- **Mine the orderings.** Which guards precede which consequential actions, at
  what support, with counter-evidence. No model call in this path, so the same
  history yields the same rules every time and a figure can be reproduced.
- **Let a person adjudicate.** Nothing is enforced that a human has not marked
  real. A mined regularity is a proposal, not a rule.
- **Serve it at the gate, and let it abstain.** Three answers, not two: the rule
  fires, the rule does not apply, or *a fact is missing and I will not guess*.
  A gate that treats "no record of a verification" as "no verification happened"
  is a closed-world assumption, and in a bank that difference is the product.
- **Retire rules loudly.** Support decays; the rule goes, with its reason, on the
  next pass.

Note what this is not: it is not a threat model, and it will not stop a poisoned
skill. It addresses the 188, not the 156. Both halves need work, and conflating
them is how a vendor ends up claiming to solve a problem it cannot see.

---

## 7. What we do not claim

- The 299-of-299 figure comes from **one private corpus** — one person's own
  machine — against a clause set that a person has not yet reviewed end to end.
  It is a lead, not a headline. Stating it that way is the point.
- Precision against a *partial* policy is uninterpretable, and we do not report
  it. Recall over the clauses an agent actually violated is the figure that
  means anything.
- Mining finds regularities, not intentions. Some are norms; some are habits;
  some are artefacts of how the work is scheduled. Which is which is a human
  judgement, and the tool's job is to bring the evidence and the
  counter-evidence, not to rule.

---

## 8. Candidate openings for the post

Pick one; they are different arguments.

**A — the measurement.**
> We found a written rule that was followed 0 times out of 299. Not ignored out
> of laziness: a *second* written rule governed the same action, and the
> behaviour picked that one. Nobody knew, because nobody was counting. Your agent
> guardrails are prose, and prose has never been audited.

**B — the majority.**
> Everyone is selling against poisoned MCP servers. In 188 of 344 verified
> enterprise AI incidents, there was no attacker at all. The agent authenticated
> normally, called a valid endpoint, and executed a permitted operation. There is
> nothing to detect, which is exactly why nothing detects it.

**C — the distinction.**
> Access control answers "may this actor do this?" It cannot answer "should this
> happen here, given what has already happened in this session?" One is fifty
> years old. The other is why a coding agent deleted a production database and
> its backups in nine seconds.

**D — the admission.**
> The best paper on agent authorization lists its own open problems. Two of them
> are: "static policies require manual updates; learned policies remain future
> work," and "independent per-call evaluation misses sequence-based attacks."
> The gate is solved. Where the rules come from is not.

---

## Sources

- NSA, *Model Context Protocol (MCP): Security Design Considerations for AI-Driven Automation*, CSI, 20 May 2026 — https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF
- Cyera, *Agent-Inflicted Damage: Inside the Real-World Failures of Enterprise AI Systems* — https://www.cyera.com/research/agent-inflicted-damage-inside-the-real-world-failures-of-enterprise-ai-systems
- Zenity, *AI Agent Destroys Production Database in 9 Seconds* (PocketOS) — https://zenity.io/blog/current-events/ai-agent-database-deletion-pocketos
- Snyk, *ToxicSkills: malicious AI agent skills* — https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- Datadog Security Labs, *Malicious coding agent skills and the risk of dynamic context* — https://securitylabs.datadoghq.com/articles/malicious-skills-supply-chain-risks-in-coding-agents-with-dynamic-context/
- Securelist (Kaspersky), *Malicious MCP servers used in supply chain attacks* — https://securelist.com/model-context-protocol-for-ai-integration-abused-in-supply-chain-attacks/117473/
- Cloud Security Alliance, *MCP Tool Poisoning: Adversarial Hijacking of AI Agent Workflows* — https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-tool-poisoning-ai-agent-exfiltration-2/
- OWASP, *Agentic Skills Top 10* — https://owasp.org/www-project-agentic-skills-top-10/
- *Before the Tool Call: Deterministic Pre-Action Authorization for Autonomous AI Agents*, arXiv 2603.20953 — https://arxiv.org/html/2603.20953v1
- Microsoft, *The state of MCP security in 2026* — https://techcommunity.microsoft.com/blog/microsoft-security-blog/the-state-of-mcp-security-in-2026/4531327

Internal figures (§5) are from `docs/results.json` and TS §15 rev. 13–15; the
299-of-299 and 9/9·12/12·5/5 results are the `cc` corpus at `cc-policy` v3.
