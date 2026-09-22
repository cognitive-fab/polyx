# Expertise — a second knowledge primitive for Claude Code

*Design exploration · 29 August 2026 · polyx*
*Revision 2 — scoping corrected from open sharing to bounded systems.*

---

## 1. The distinction that makes it a different thing

A **skill** is instructions. Prose, loaded into the context window, asking the model to behave a certain way. It is advisory, it competes for attention with everything else in context, and — the part that matters — **it cannot be wrong in a checkable way.** Nobody has ever deleted a line from a skill because the line stopped being true. They rot in place.

An **expertise** is a decision procedure carrying evidence: rules derived from observed work, each with measured support, each evaluable deterministically at a decision point, each able to abstain, each retirable when its support decays.

> A skill is what I know how to tell you.
> An expertise is what I have been shown to do.

That difference is not cosmetic, and the whole design falls out of it — including, as §4 argues, how far it can travel.

---

## 2. Why it must not be loaded into context

The tempting implementation is a skill whose body happens to contain rules. That implementation is worthless, and it's worth being explicit about why.

The moment an expertise enters the context window it inherits every property of a skill: it costs tokens whether or not it's relevant, the model may or may not attend to it, and its "enforcement" is a polite request. A hundred mined rules pasted into context is a worse skill, not a better primitive.

**An expertise is queried, not loaded.** It sits outside the context window as an evaluable artifact. At a decision point the harness — or the model — asks it a question and gets back a verdict plus evidence. Nothing enters context except the answer.

Three consequences:

- **Cost is proportional to firing, not to installation.** A hundred installed expertises cost nothing until one applies. Skills cannot make that claim, and it is the reason a user can have many expertises and only a few skills.
- **The answer is deterministic.** The same state produces the same verdict. Not "the model usually remembers to check".
- **It can say "I don't know."** A rule set with abstention semantics distinguishes *no rule covers this* from *a rule would cover this but I'm missing a fact*. A prose skill cannot express that at all.

---

## 3. Anatomy

```
verified-push.expertise/
  EXPERTISE.md         # human-readable: what this knows, and where it came from
  manifest.json        # id, version, triggers, scope, provenance summary
  profile.acv.json     # the ACV profile: consequence, verifies, bindings
  rules/
    obligations.json   # constraints on consequential actions
    recommendations.json
  evidence/
    summary.json       # aggregate support; NOT the corpus
    attestation.sig    # signed: mined by polyx vX from N interactions at these floors
  LICENSE
```

`EXPERTISE.md` is what a human reads before installing. It is not the runtime — it's the README — and keeping those separate is what stops the format collapsing back into a skill.

A rule, concretely:

```json
{
  "id": "a3f9…",
  "family": "obligation",
  "statement": "no push without a passing verification",
  "trigger": { "action": "git push" },
  "predicate": "(path) => path.emitted.every((e,i) => e.kind!=='git-push' || path.actionBefore('VERIFY_PASSED', i))",
  "window": "session",
  "support": { "holds": 68, "of": 69 },
  "provenance": { "kind": "own", "level": "team" },
  "counterexamples": 1
}
```

`support` and `counterexamples` are load-bearing. **A rule shipped without its counter-evidence is a claim, not a finding** — and the format should refuse to serialise one.

---

## 4. Where expertise travels — and where it doesn't

The original version of this document assumed expertise would circulate the way skills do: publicly, between strangers, in a commons. **That was wrong**, and the reason is more structural than it first appears.

### 4.1 Skills travel along the profession; expertise travels along the system

A skill is portable *because it is vague*. "How to review a pull request" applies anywhere, because it commits to nothing specific and its vocabulary is English.

An expertise is valuable *because it is specific* — it names actual actions, actual guards, actual thresholds. And specificity is exactly what binds it to a system. The knowledge that a refund must follow an order lookup is worth something only where "refund" and "order lookup" are the real names of real operations.

**So the boundary an expertise can cross is the boundary of the system it describes, not the boundary of the job title that uses it.**

### 4.2 Three independent walls at the company boundary

Cross-company sharing fails three times over, and any one of them would be enough:

1. **Trade secret.** The rules *are* the operational advantage. A bank's actual underwriting practice, a support organisation's escalation heuristics, a merchant's pricing behaviour — mining them produces exactly the document a competitor would pay for. Skills don't have this problem because skills say nothing specific enough to be worth stealing.
2. **Liability.** An obligation rule that gates actions is much closer to professional advice than a prose suggestion is. If A publishes "never quote without a disclosure", B adopts it, and B's regulator required something stricter, the question of who was responsible has an uncomfortable answer. Nobody wants to be the publisher of executable compliance policy for strangers.
3. **The alphabet.** Even setting the first two aside, the vocabularies don't line up, and aligning them is unreliable work.

The useful observation is that **all three walls fall at the same boundary.** Inside a bounded system the vocabulary is shared by construction, the parties are not competitors, and liability sits inside an existing relationship. This isn't three problems needing three solutions — it's one scoping decision.

### 4.3 The topologies that actually work

| # | Topology | Alphabet | Secrecy | Notes |
|---|---|---|---|---|
| 1 | **Team → team** — colleagues on the same repo, workspace, or CRM instance | shared by construction | none | The default. Analogous to a shared lint config or CI policy. Lowest friction, highest immediate value. |
| 2 | **Vendor → installed base** — a SaaS or API vendor ships expertise to every customer using their system | **the vendor's own product surface — canonical by definition** | none for the vendor; it's their documented best practice | The strongest channel, and the most underrated. See §4.4. |
| 3 | **OSS project → users** — a framework ships rules for its own CLI | the project's commands | none | How you bootstrap adoption. Costs nothing, spreads the format. |
| 4 | **Industry body → members** — a standards or regulatory body publishes obligation rules | the standard's vocabulary | none — these are rules everyone must follow | Liability already sits with the body. FIBO/ACORD/EDM-Council-shaped. |
| 5 | **Integrator → clients** — an SI or consultancy packages deployment knowledge | the platform's | contractual | Commercial, bounded by agreement. |
| 6 | ~~Peer → public commons~~ | doesn't line up | fatal | The one to abandon. |

Topologies 1–5 cover everything worth building for. Only 6 required the open commons, and only 6 is out.

### 4.4 Vendor-shipped expertise is the interesting one

Every vendor with an API and an agent story has the same problem: **customers' agents misuse their surface.** Stripe knows what a bad Stripe integration looks like. Salesforce knows what a bad Salesforce agent does. Today that knowledge lives in documentation — prose, unenforceable, largely unread.

An expertise bundle makes it executable *at the customer's gate*. And the vendor's alphabet is canonical by definition, because it is their own API.

The natural carrier in the Claude Code world is the one already being installed: **the MCP server or plugin.** It already declares its tools. Letting it also declare, for those tools, an ACV profile and a shipped rule set is a small extension with a large payoff — you install the capability and the knowledge of how it goes wrong in the same act, rather than from a separate marketplace.

The vendor's incentive is selfish and immediate: fewer customer incidents caused by agents driving their API badly. That is the schema.org "rich results" equivalent — the day-one payoff that makes a vocabulary spread without a mandate.

### 4.5 What *is* shareable across companies, and how to tell

One category crosses the boundary safely and shouldn't be thrown out with the rest: **rules that encode something already public.** "Never quote a rate without a disclosure" is not a trade secret; it's regulation. A vendor's documented API semantics are not secret; they're documentation.

This maps cleanly onto the two rule families:

- **Obligations** are often shareable, because they frequently restate public policy or published semantics.
- **Recommendations** are almost never shareable — what you offer to whom, when you discount, when you escalate — because that *is* the commercial advantage.

And there is already a mechanism that classifies which is which. The conformance diff (mined rules × written policy) produces three regions, and two of them answer the sharing question directly:

| Region | Meaning | Shareable? |
|---|---|---|
| mined ∧ written | confirmed — restates a public or documented rule | **yes** |
| mined ∧ ¬written | tribal knowledge — your own undocumented practice | **no. This is the trade secret.** |
| ¬mined ∧ written | compliance gap | n/a — a finding, not an asset |

**The compliance product and the publication filter are the same computation.** That was not designed; it fell out, which is usually a sign the decomposition is right.

---

## 5. Replay: from trust to conformance

Replay was originally justified as the answer to *"why should I trust a stranger's rules?"* — install them and they get scored against your own history before you believe anything.

Inside a bounded system the trust question is weaker: you already trust your colleague, your vendor, your regulator. But replay does not become less useful. It changes job.

```
$ claude expertise add @stripe/payments-safety
  added stripe/payments-safety · 23 rules · vendor-published

$ claude expertise replay stripe/payments-safety

  holds   of   verdict     would block   surface
     41   44   OWN                   3   checkout-service
     37   38   OWN                   1   billing-worker
      8   31   neither              23   legacy-importer

  19 of 23 rules hold here. 4 do not — see `--show`.
```

Three distinct readings, and all three matter:

- **Conformance.** Which of the vendor's rules does your deployment already keep? Adopt those as `own`.
- **Finding.** Which do you systematically violate? That's either a real defect (`legacy-importer` at 8 of 31 is a bug report) or evidence the rule doesn't fit your use — and the tool cannot tell you which, so it must not pretend to.
- **Alignment check.** If a rule scores near zero, the mapping between the vendor's terms and yours may simply be wrong. Same signal, different cause; also undecidable from the number alone.

So replay stops being a trust mechanism and becomes a **conformance and diagnosis** mechanism. Arguably more valuable, and certainly easier to explain: *"here is where your system disagrees with its vendor."*

Provenance levels should follow the topologies rather than the old machine-local lattice:

```
self  →  team  →  org  →  vendor  →  body  →  neither
```

The level names the kind of authority a rule has, and a rule can be adopted at one level while remaining borrowed at another.

---

## 6. Triggering — one reliable mechanism and one weak one

**Positional triggering (reliable).** An expertise declares the action types it has rules about — its ACV profile already names them. The harness consults it via a `PreToolUse`-style hook when a matching action is about to happen. No model involvement, deterministic, sub-millisecond, and it fires *before* the effect. This is the mechanism that should carry the weight.

**Topical triggering (weak, and known to be weak).** The model recognises it is in a situation an expertise covers and asks. This is what skills do, and for expertise it's measurably worse: polyness's own recognition experiment scores 1 right against 15 from a three-step prefix, and says so in a test rather than in a sentence. Ship it, measure it, don't build on it.

Which tells you what expertise is *for*: strong exactly where there is a consequential action to hang a rule on, weak where the decision is diffuse. A real limit, not a temporary one.

Three verdicts, and the caller must distinguish them:

| Verdict | Meaning | Default effect |
|---|---|---|
| `permit` / silent | no rule objects | proceed |
| `warn` | an obligation's antecedent holds and its consequent doesn't | surface to model and user; proceed |
| `abstain` | uncovered, or covered but a fact is missing | proceed, and *say so* — the model now knows it is inferring |

Blocking is deliberately absent from the defaults. See §8.

---

## 7. Developer experience

```
$ claude expertise list
  team/verified-push       obl 3  · rec 0   · own@team    · fired 4× today
  @stripe/payments-safety  obl 23 · rec 0   · vendor      · 19 adopted, 4 borrowed
  org/refund-policy        obl 11 · rec 12  · own@org     · retired 1 rule (stale)

$ claude expertise why @stripe/payments-safety/a3f9
  "no charge capture without an idempotency key"
  holds 41 of 44 here · 3 counterexamples:
    2026-08-14  checkout-service  capture without key after retry   [show]
```

Two properties that matter more than the commands:

**Firing must be visible in the transcript.** When a rule answers a decision, the session shows it — and equally, when everything abstained, the session shows that the model was inferring unaided. This is how "inference displaced" stops being a slide and becomes something a developer feels. A quiet expertise is indistinguishable from an absent one.

**Retirement must be automatic and loud.** Memory files rot because nothing ever deletes from them. An expertise whose support has decayed below its floor gets retired on the next replay, with its reason recorded, and the user learns from a notice rather than from an audit.

---

## 8. Trust, and why blocking is opt-in

Even inside a bounded system, an installed expertise is executable policy someone else wrote. Vendor-published is not the same as harmless, and a compromised vendor bundle is a supply-chain vector.

- **Advise and warn by default. Blocking is a local, per-expertise opt-in.** A rule set that can silently deny actions is a denial-of-service primitive; one that can silently *permit* is worse, because it looks like an approval.
- **Sign the bundle and the attestation.** The attestation names the miner, its version, the corpus size and the thresholds — not the data.
- **Rules crossing a boundary should not be arbitrary code.** Shipping JavaScript closures means shipping executable code. A restricted predicate language — Datalog-shaped, no I/O, guaranteed termination — is the right target for anything that leaves the machine, even if local expertises stay closures for speed. This is where the Datalog argument pays off: not expressiveness, *safety of transport*.
- **ACV downgrades deserve special attention.** The realistic hostile edit to a vendor bundle is not a rule — it's the profile, changing an action's consequence from `irreversible` to `none`. The ACV specification requires consumers to surface consequence downgrades on version change; expertise tooling should honour that and require confirmation.
- **Conflicts are surfaced, never silently resolved.** Precedence is by provenance level, then explicit user ordering — never recency, never install order.

---

## 9. The commercial split, revised

**polyx is the miner: paid.** Deriving rules from logs, the alphabet work, provenance, the evaluation harness, the conformance diff.

**Expertise is the format and the runtime: free, open, independent.** An open spec, an open evaluator, freely runnable bundles. Anyone can hand-write one; anyone can run one; nothing phones home.

The bounded-system scoping **weakens one argument and strengthens two**.

*Weakened:* the network-effects story. A public commons of shared expertise would have advertised the miner continuously. There will be no commons, so that engine is gone.

*Strengthened — the buyer is now obvious.* If expertise is bounded to a system, the party who wants a miner is the party who owns a system: an organisation running the CRM, or a **vendor who wants to ship good defaults to their entire installed base**. Vendor-as-customer is a materially better business than developer-as-customer — fewer accounts, larger, recurring, and each one propagates the format to their customers as a side effect of their own self-interest.

*Strengthened — non-shareability raises willingness to pay.* If a bank's mined rules are competitively valuable *and* cannot be obtained from a free community bundle, that is precisely why the bank will pay to have them mined. The trade-secret objection that kills the commons is the same fact that makes the product defensible.

The free layer is therefore: **the format, the runtime, and vendor- and body-published profiles** — not a peer-to-peer commons. That is a smaller free layer and a clearer business.

---

## 10. Problems, updated

**The alphabet problem is now mostly solved by scoping.** Inside a bounded system the vocabulary is shared by construction — the same repo, the same CRM instance, the same vendor API. This was the largest open problem in revision 1 and the rescoping substantially dissolves it. What remains is the narrower case of topologies 4 and 5, where a body's or integrator's vocabulary meets a client's, and that is exactly what ACV's optional `binds` is for. The general cross-company alignment problem is no longer on the critical path.

**Replay still needs a local corpus.** A new deployment has no history, so everything stays `borrowed` and the most useful feature is invisible exactly when someone is deciding whether to care. Partial answer: vendor bundles can ship a conformance fixture so replay has something to say on day one — though that is the vendor's fixture, which is a weaker claim than your own history and must be labelled as such.

**Recommendation rules may not clear the instance floor.** Obligations recur by nature; recommendations are contingent on a specific customer base and may be too sparse per segment to reach five instances. If so, expertise is an obligation-warning service — smaller, still real, and now with a clean story about why the recommendation half was never going to be shareable anyway.

**Naming.** "Expertise" pairs well with "skill". "Practice" is arguably more accurate — a practice is something you *do repeatedly*, which is literally what gets mined — and avoids the faint grandiosity. Under the bounded-system framing, "practice" reads better still: *the team's practice*, *the vendor's recommended practice*. Worth deciding before a spec fixes it.

---

## 11. What to build first

The smallest thing that proves the concept is still not the miner. It's **the format plus replay** — but the demo target has changed.

1. **Spec the bundle**, layered on ACV for the term declarations. Write three by hand. No mining.
2. **A free open evaluator** — install, query, three verdicts, `PreToolUse` triggering.
3. **`replay` against a local corpus** — now framed as conformance, not trust.
4. **One vendor-shaped bundle** for a system with a public API and a real installed base. This is the demo that opens the topology-2 channel, and it needs no partner's private data.
5. **Then** wire polyx in as one way — not the only way — to produce a bundle.

The demo has changed with the scoping, and the new one is easier to sell because it needs no stranger to trust:

> *You installed your vendor's expertise for their own API. Nineteen of their twenty-three rules already hold in your codebase. Four don't — and here is what happened the times they broke.*

That is a conformance report against a system's own vendor, delivered in one command, and nothing in the ecosystem produces it today.
