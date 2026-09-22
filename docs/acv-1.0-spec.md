# Action Consequence Vocabulary (ACV) 1.0

**Unofficial Draft — 29 August 2026**

**This version:** `acv-1.0-draft-20260829`
**Editor:** Jean-Jacques Dubray
**Feedback:** issues against the specification repository

---

## Status of This Document

This is an **unofficial draft**. It has no standing, has not been reviewed or endorsed by any standards body, and may change without notice. It is published to solicit implementation experience and to establish a shared vocabulary early enough to be useful.

The namespace IRI used throughout (`https://acv-spec.org/ns/1.0#`) is **provisional**. A permanent namespace under a neutral authority is a prerequisite for a v1.0 Final; a vendor-controlled namespace is explicitly discouraged and would undermine the purpose of this specification.

Implementers should expect breaking changes before Final. The extensibility rules in §9 are designed so that early adopters are not stranded.

---

## Abstract

The Action Consequence Vocabulary (ACV) is a minimal, JSON-first vocabulary for declaring, for each kind of action an autonomous agent can take, **what taking it costs and what taking it proves**.

ACV does not describe what happened (trace formats do that), nor what things are (domain ontologies do that), nor what an agent ought to do (rule and policy languages do that). It supplies the small set of facts those three layers all presuppose and none of them carry: whether an action can be undone, whether it counts as evidence, and whether it may be suggested.

An ACV **profile** is a document binding a set of action terms to these declarations. Profiles are intended to be authored per domain and per organisation, published freely, and consumed by rule miners, runtime gates, advisory engines, and human reviewers.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Where ACV sits](#2-where-acv-sits)
3. [Conformance](#3-conformance)
4. [Terminology](#4-terminology)
5. [The profile document](#5-the-profile-document)
6. [Terms](#6-terms)
7. [Claims](#7-claims)
8. [Consumer behaviour](#8-consumer-behaviour)
9. [Extensibility and versioning](#9-extensibility-and-versioning)
10. [Serialisation, media type and discovery](#10-serialisation-media-type-and-discovery)
11. [Security and privacy considerations](#11-security-and-privacy-considerations)
12. [Examples](#12-examples)
- [Appendix A — JSON Schema](#appendix-a--json-schema-normative)
- [Appendix B — JSON-LD context](#appendix-b--json-ld-context-normative)
- [Appendix C — Relationship to existing specifications](#appendix-c--relationship-to-existing-specifications-informative)
- [Appendix D — Design rationale and rejected features](#appendix-d--design-rationale-and-rejected-features-informative)
- [References](#references)

---

## 1. Introduction

### 1.1 Motivation

Systems that supervise, constrain, or learn from autonomous agents repeatedly need to answer three questions about an action the agent is about to take, or has taken:

1. **Can it be undone?** A guardrail that treats a database read and a wire transfer identically is either useless or intolerable.
2. **Does it establish anything?** "Do not deploy without a passing test" requires knowing which actions constitute a passing test *in this environment*.
3. **May it be suggested?** An advisory system that proposes actions needs to know which actions are its to propose.

These questions are answered today by hardcoded lists inside individual tools. The list is rewritten per tool, per organisation, and per deployment; it is rarely reviewed by the people who know the answers; and it cannot be shared, because there is no format for it.

Meanwhile, three adjacent layers are well served. Trace formats describe what happened. Domain ontologies describe what things are. Rule and policy languages describe what should hold. **None of them carries consequence.** A financial ontology can state that a loan offer is a loan offer; it does not state that issuing one cannot be recalled. A trace format records that a refund was issued; it does not record that refunds are compensable rather than free.

ACV fills exactly that gap and stops there.

### 1.2 Design principles

**Thin.** A conforming profile needs three fields per term. The specification is deliberately smaller than the problem it enables, because vocabularies that require study before publication do not get published.

**Layered, not replacing.** ACV annotates terms defined elsewhere. It introduces no trace format, no ontology, and no rule language, and a profile is useless on its own — which is the intended relationship to the layers it serves.

**Optional binding.** A profile MAY bind its terms to published vocabularies. It is not required to. A profile whose terms are local strings is fully conforming.

**Fail-safe defaults.** Where a consumer cannot determine consequence, it treats the action as irreversible. Unrecognised values degrade toward caution, never toward permission (§8.4, §9.3).

**JSON first, RDF compatible.** Authors write YAML or JSON and need know nothing about RDF. A normative JSON-LD context (Appendix B) makes every profile an RDF graph for those who want one.

---

## 2. Where ACV sits

```
   ┌──────────────────────────────────────────────────────────────┐
   │  CONSUMERS — what should happen                              │
   │  rule miners · runtime gates · advisory engines · reviewers  │
   │  (expertise bundles, DECLARE constraints, guardrail DSLs)    │
   └───────────────────────────┬──────────────────────────────────┘
                               │ reads
   ┌───────────────────────────▼──────────────────────────────────┐
   │  ACV — what acting COSTS and PROVES                          │
   │  consequence · verifies · recommendable · binds              │
   └───────┬──────────────────────────────────────┬───────────────┘
           │ annotates terms from                 │ classifies events in
   ┌───────▼──────────────────┐      ┌────────────▼─────────────────┐
   │  DOMAIN VOCABULARIES     │      │  TRACE FORMATS               │
   │  what things ARE         │      │  what HAPPENED               │
   │  FIBO · ISO 20022 ·      │      │  OCEL 2.0 · ADP ·            │
   │  schema.org Actions      │      │  OTel GenAI · XES            │
   └──────────────────────────┘      └──────────────────────────────┘
```

**ACV is not a trace format.** It says nothing about a particular occurrence. Events belong in OCEL 2.0, the Agent Data Protocol, OpenTelemetry GenAI conventions, or whatever the deployment already uses. A profile classifies the *types* those traces reference.

**ACV is not an ontology.** It asserts nothing about what a refund *is*, what it relates to, or how it decomposes. It presumes a term already denotes something and adds four pragmatic facts about acting on it.

**ACV is not a rule language.** It carries no constraints and no obligations. Deliberately: a profile that could say "never refund without a lookup" would pre-empt the systems that discover or author such rules. A profile states that a lookup *verifies order existence*; whether anything must therefore precede a refund is not ACV's business. See Appendix D.1.

### 2.1 Intended uses

- **Rule mining.** Selecting which action types are worth mining constraints around, and which can serve as guards.
- **Runtime enforcement.** Deciding which actions a pre-execution gate intercepts, and how severe a mistaken permission would be.
- **Advisory systems.** Determining which actions an engine may propose and which it must leave to a human or a model.
- **Human review.** Giving a domain expert a reviewable artefact — one screen, four facts per action — in place of a list buried in source code.
- **Portability.** Allowing a rule set authored against one organisation's terms to be evaluated against another's, once profiles are aligned.

---

## 3. Conformance

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in [BCP 14] ([RFC 2119], [RFC 8174]) when, and only when, they appear in all capitals.

This specification defines three conformance classes.

**Conforming profile document.** A JSON or YAML document that validates against the schema in Appendix A and satisfies every normative requirement in §5–§7.

**Conforming producer.** Software that emits conforming profile documents. A producer MUST NOT emit a term whose `consequence` it has not determined; omission is not permitted (§6.3).

**Conforming consumer.** Software that reads profile documents and satisfies §8. A consumer MUST implement the fail-safe behaviour of §8.4 and §9.3. A consumer MAY ignore any field it does not use, but MUST NOT reject a document for containing fields it does not recognise (§9.2).

---

## 4. Terminology

**Action term** (or **term**) — an identifier for a kind of action an agent can take. Terms are opaque to this specification; their meaning is established by the profile's domain, optionally by a binding (§6.6).

**Profile** — a document declaring ACV facts for a set of terms and claims.

**Claim** — a named, observable proposition about the world that performing certain terms establishes (§7).

**Consequence** — the degree to which an action's effect can be undone (§6.3).

**Actor** — the party performing an action: an agent, a human operator, or a system.

**Compensating action** — an action available to the actor that reverses or offsets the effect of a prior action, at some cost.

---

## 5. The profile document

### 5.1 Structure

```yaml
acv: "1.0"                       # REQUIRED
id: "https://acme.example/acv/support"   # REQUIRED
version: "3"                     # REQUIRED
title: "Acme customer support actions"   # REQUIRED
description: "..."               # OPTIONAL
domain: "customer-support"       # OPTIONAL
extends: []                      # OPTIONAL
claims: []                       # OPTIONAL
terms: []                        # REQUIRED, MUST contain at least one term
```

### 5.2 Member definitions

| Member | Type | Req. | Definition |
|---|---|---|---|
| `acv` | string | MUST | The specification version this document conforms to. For this specification, `"1.0"`. |
| `id` | IRI | MUST | A stable identifier for this profile. SHOULD be dereferenceable. MUST NOT change across versions of the same profile. |
| `version` | string | MUST | A version label, opaque to consumers, that MUST change whenever any term or claim changes. |
| `title` | string | MUST | A short human-readable name. |
| `description` | string | MAY | A prose description of the profile's scope. |
| `domain` | string | MAY | A domain hint (e.g. `banking`, `retail`, `software-engineering`). Informative only. |
| `extends` | array of IRI | MAY | Profiles this one builds upon. See §5.3. |
| `claims` | array of Claim | MAY | Claims referenced by this profile's terms (§7). |
| `terms` | array of Term | MUST | The action terms this profile declares (§6). MUST contain at least one member. |

A document MUST NOT declare two terms with the same `id`, nor two claims with the same `id`.

### 5.3 Profile extension

A profile listing another in `extends` inherits that profile's terms and claims.

- A term in the extending profile with the same `id` as an inherited term **replaces** it entirely. Member-level merging MUST NOT be performed; partial overrides are a source of silent error and are prohibited.
- A consumer that cannot resolve a profile named in `extends` MUST fail loudly and MUST NOT proceed with the partial profile. Silently evaluating rules against an incomplete consequence model is precisely the failure this specification exists to prevent.
- `extends` MUST NOT contain cycles. A consumer detecting a cycle MUST reject the profile.

---

## 6. Terms

### 6.1 Structure

```yaml
- id: "action:issue_refund"       # REQUIRED
  label: "Issue refund"           # REQUIRED
  definition: "..."               # RECOMMENDED
  consequence: compensable        # REQUIRED
  recommendable: true             # REQUIRED if consequence is irreversible
  verifies: []                    # OPTIONAL
  binds: {}                       # OPTIONAL
  actor: agent                    # OPTIONAL
```

### 6.2 `id` and `label`

`id` MUST be a string that is unique within the profile after extension resolution. It MAY be an IRI, a CURIE, or an opaque local string. Consumers MUST treat `id` as opaque and MUST NOT derive meaning from its lexical form.

`label` MUST be a short human-readable name suitable for display in a review interface.

`definition` SHOULD be present. It is the text a domain expert reads when confirming the declaration, and its absence materially reduces the reviewability that motivates this specification.

### 6.3 `consequence`

**REQUIRED.** One of the following values, which form a **total order** from least to most severe:

| Value | Definition |
|---|---|
| `none` | The action has no effect outside the acting system's own state. Reads, searches, queries, computations. |
| `reversible` | The action changes state that the actor can restore to its prior condition at negligible cost, with no party having observed or relied upon the intermediate state. |
| `compensable` | The action changes state observable by, or relied upon by, another party, and a compensating action is available to the actor. The compensating action is itself an action with cost and is itself observable. |
| `irreversible` | No compensating action is available to the actor. The effect stands. |

Three consequences of these definitions are normative and are frequently got wrong:

1. **Observation by another party defeats `reversible`.** An action whose effect any other party has seen is at most `compensable`, regardless of how easily the state can be rewritten. A message that can be deleted after being read is `compensable`, not `reversible`.
2. **`compensable` requires the compensating action to be *available to the actor*.** An effect that only a different, more privileged party can undo is `irreversible` from the actor's standpoint. Consequence is declared relative to the actor, not to the organisation.
3. **`consequence` is a factual declaration, not a policy preference.** It states what the world permits, not what the organisation wishes. Policy belongs in `recommendable` and in the consumer's own configuration.

A producer that cannot determine a term's consequence MUST declare `irreversible` rather than omitting the member or guessing lower.

### 6.4 `recommendable`

A boolean stating whether an advisory system MAY propose this action.

- **REQUIRED** when `consequence` is `irreversible`.
- **OPTIONAL** otherwise, defaulting to `true`.

The asymmetry is deliberate: the author is obliged to make an explicit decision exactly where the cost of a wrong default is unbounded, and is spared the ceremony everywhere else.

`recommendable: false` does not prohibit the action. It states that proposing it is not an advisory system's business — the decision belongs to a human or to a model reasoning in context.

### 6.5 `verifies`

An array of verification statements. Each declares that performing this term establishes a claim (§7), optionally conditional on the action's result.

```yaml
verifies:
  - claim: "tests.passing"
    whenResult: ok        # ok | failed | any   (default: ok)
```

| Member | Type | Req. | Definition |
|---|---|---|---|
| `claim` | string | MUST | The `id` of a claim declared in this profile or an inherited one. A consumer encountering an unresolvable `claim` MUST reject the profile. |
| `whenResult` | enum | MAY | `ok`, `failed`, or `any`. Default `ok`. The action establishes the claim only when its recorded result matches. |

`whenResult` exists because the common case is a verification that establishes its claim **only on success**. Running a test suite that fails does not establish that tests pass; treating "the test command ran" as equivalent to "the tests passed" is a defect that has occurred in real systems, and this member exists to make it unrepresentable.

`verifies` states what an action *proves*. It MUST NOT be read as stating what any action *requires*; ACV cannot express requirements (§2, Appendix D.1).

### 6.6 `binds`

An OPTIONAL object mapping this term to terms in external vocabularies, using [SKOS] mapping semantics.

```yaml
binds:
  exactMatch: ["https://schema.org/ReturnAction"]
  closeMatch: ["urn:acme:legacy:REFUND_V2"]
  broadMatch: []
  narrowMatch: []
```

Each member is an array of IRIs and is OPTIONAL. `exactMatch` asserts interchangeability in this vocabulary's intended applications; `closeMatch` asserts sufficient similarity for the purposes of this specification without asserting equivalence.

**`closeMatch` is expected to be the common case and this is not a deficiency.** ACV consumers evaluate predicates over terms; they do not perform logical inference across bindings. The bar is co-reference sufficient to score a predicate, which is materially lower than formal equivalence, and asserting `exactMatch` where only `closeMatch` holds imports error for no benefit.

A binding MUST NOT be treated as transitive by a consumer. If A `closeMatch` B and B `closeMatch` C, a consumer MUST NOT infer any relation between A and C.

### 6.7 `actor`

An OPTIONAL enum: `agent`, `human`, `system`, or `any` (default `any`). Names the party that performs the action. Informative in this version; reserved for consumers that distinguish rules by actor.

---

## 7. Claims

A claim is a named, observable proposition that certain terms establish.

```yaml
claims:
  - id: "identity.verified"                    # REQUIRED
    label: "Customer identity verified"        # REQUIRED
    definition: "The customer's identity has been confirmed against a
                 system of record during the current interaction."   # RECOMMENDED
    decaysAfter: "PT30M"                       # OPTIONAL, ISO 8601 duration
```

| Member | Type | Req. | Definition |
|---|---|---|---|
| `id` | string | MUST | Unique within the profile after extension resolution. |
| `label` | string | MUST | Short human-readable name. |
| `definition` | string | SHOULD | The proposition, stated precisely enough that a reviewer can judge whether a term establishes it. |
| `decaysAfter` | duration | MAY | An [ISO 8601] duration after which a consumer SHOULD NOT treat the claim as established by an earlier action. Absent means the claim does not decay within the scope in which it is evaluated. |

Claims are deliberately flat: they have no hierarchy, no logical structure, and no negation. A claim is a label that verifying actions and consuming rules agree upon. Anything richer belongs in a rule language or an ontology, not here.

`decaysAfter` is the one temporal concession, and it earns its place: "verified earlier in this session" and "verified four hours ago" are different facts, and consumers that cannot distinguish them will over-permit.

---

## 8. Consumer behaviour

### 8.1 General

A conforming consumer MUST resolve `extends` before evaluating any term (§5.3), MUST reject profiles with duplicate or unresolvable identifiers, and MUST apply §8.4 and §9.3.

### 8.2 Miners

A consumer that derives rules from observed behaviour:

- SHOULD restrict constraint mining to terms whose `consequence` is at or above a configured floor, and SHOULD default that floor to `compensable`. Mining constraints around `none`-consequence terms produces regularities that are true and unenforceable.
- SHOULD use `verifies` to identify candidate guards rather than inferring guard status from co-occurrence alone.
- MUST NOT treat a `verifies` entry as evidence that any rule exists. The vocabulary states capability; support is the miner's to measure.

### 8.3 Gates and advisory engines

- A gate SHOULD intercept terms in descending order of `consequence` where resources are limited.
- An advisory engine MUST NOT propose a term whose `recommendable` is `false`.
- An advisory engine MUST NOT treat the absence of a fact as its negation. Where a claim's status is unknown, the engine MUST abstain rather than evaluate the dependent condition as false. This requirement is stated here because the failure is common and its consequences in regulated domains are severe.

### 8.4 Unknown terms

A consumer encountering an action type with **no** declaration in any loaded profile MUST treat it as:

- `consequence: irreversible`
- `recommendable: false`
- `verifies: []`

A consumer MAY report unknown terms and SHOULD do so. A consumer MUST NOT silently treat an undeclared term as `none`.

---

## 9. Extensibility and versioning

### 9.1 Specification versioning

The `acv` member carries the specification version. A consumer encountering a major version it does not implement MUST reject the document. A consumer encountering an unrecognised *minor* version MUST process the document according to the highest minor version it implements, applying §9.2 and §9.3.

### 9.2 Unknown members

A consumer MUST NOT reject a document because it contains members not defined in this specification. Unknown members MUST be ignored for evaluation and SHOULD be preserved by any software that rewrites the document.

Implementations introducing non-standard members SHOULD prefix them (`x-`) or namespace them by IRI.

### 9.3 Unknown enumerated values

A consumer encountering an unrecognised value for an enumerated member MUST apply the most conservative recognised interpretation:

| Member | Unrecognised value treated as |
|---|---|
| `consequence` | `irreversible` |
| `recommendable` | `false` |
| `whenResult` | `ok` |
| `actor` | `any` |

This rule permits the enumerations to be extended in future versions without any older consumer becoming unsafe — only more cautious.

---

## 10. Serialisation, media type and discovery

### 10.1 Serialisations

The normative interchange format is JSON, as constrained by Appendix A.

YAML MAY be used for authoring and MUST be interpreted as the JSON obtained by the YAML 1.2 JSON schema. Producers publishing profiles for consumption by others SHOULD publish JSON.

A profile MAY be interpreted as RDF by applying the JSON-LD context in Appendix B. Conformance does not require RDF processing.

### 10.2 Media type

The media type `application/acv+json` is to be registered. Until registration, `application/json` with a `profile` parameter naming the ACV namespace SHOULD be used.

File extension: `.acv.json` (or `.acv.yaml` for authoring).

### 10.3 Discovery

An organisation publishing a profile for its own action surface SHOULD make it available at a stable IRI equal to the profile's `id`.

A consumer MAY discover profiles for a host at `/.well-known/acv`, returning either a profile document or a JSON array of profile IRIs. Support for well-known discovery is OPTIONAL.

---

## 11. Security and privacy considerations

**A profile is a safety-relevant assertion.** Understating `consequence` causes gates to under-protect and miners to ignore actions that warrant constraints. A profile obtained from an untrusted source is an untrusted claim about how dangerous the recipient's own actions are.

**Profiles crossing a trust boundary SHOULD be signed**, and consumers SHOULD verify signatures before use. This specification does not define a signature format; detached signatures over the canonical JSON serialisation are RECOMMENDED pending one.

**Downgrade is the attack to defend against.** The realistic hostile edit is changing `irreversible` to `none`, or `recommendable: false` to `true`. Consumers SHOULD surface consequence *downgrades* when a profile version changes, and SHOULD require explicit confirmation before applying them. Upgrades toward caution need no ceremony.

**Never merge untrusted profiles silently.** Where a consumer loads profiles from multiple sources, conflicting declarations for one term MUST be reported, and the consumer MUST resolve the conflict toward the most severe `consequence` and the least permissive `recommendable`. Resolution by load order, recency, or file precedence MUST NOT be used.

**Free-text members are untrusted input.** `label`, `definition`, and `description` may be rendered into interfaces or into the context of a language model. Consumers MUST treat them as data, never as instructions, and SHOULD escape them on display.

**Profiles describe types, not instances, and MUST NOT contain personal data.** A term's `label` or `definition` naming an individual, an account, or a customer is a defect. Profiles are intended to be publishable; treating them as such at authoring time is the safeguard.

**Extension resolution is a network operation.** `extends` IRIs are fetched. Consumers SHOULD restrict resolution to configured origins, SHOULD apply timeouts, and MUST enforce the cycle rule of §5.3.

---

## 12. Examples

### 12.1 Retail customer support

```yaml
acv: "1.0"
id: "https://acme.example/acv/support"
version: "3"
title: "Acme customer support actions"
domain: "retail"

claims:
  - id: "order.located"
    label: "Order located"
    definition: "An order matching the customer's request has been retrieved
                 from the order system during this interaction."
  - id: "identity.verified"
    label: "Customer identity verified"
    definition: "Identity confirmed against a system of record."
    decaysAfter: "PT30M"

terms:
  - id: "action:order_lookup"
    label: "Look up order"
    definition: "Query the order system by order number or customer email."
    consequence: none
    verifies:
      - claim: "order.located"
        whenResult: ok
    binds:
      closeMatch: ["https://schema.org/SearchAction"]

  - id: "action:issue_refund"
    label: "Issue refund"
    definition: "Return funds to the customer's original payment method.
                 Reversible only by requesting payment again, which is a
                 separate action visible to the customer."
    consequence: compensable
    binds:
      closeMatch: ["https://schema.org/ReturnAction"]

  - id: "action:close_account"
    label: "Close account"
    definition: "Permanently close the customer's account. No action available
                 to support staff restores it."
    consequence: irreversible
    recommendable: false

  - id: "action:escalate"
    label: "Escalate to human"
    definition: "Transfer the interaction to a human agent."
    consequence: compensable
    recommendable: true
    actor: agent
```

Note `action:escalate`. It is trivially "undoable" in the sense that a human can hand the interaction back — but the customer has observed the transfer and a colleague's time has been consumed, so `reversible` would be wrong under §6.3(1). This is the classification producers most often get wrong.

### 12.2 Retail banking, bound to a published vocabulary

```yaml
acv: "1.0"
id: "https://bank.example/acv/branch-advisory"
version: "1"
title: "Branch advisory actions"
domain: "banking"

claims:
  - id: "suitability.assessed"
    label: "Suitability assessed"
    definition: "A suitability assessment for the product under discussion has
                 been completed and recorded for this customer."
  - id: "disclosure.delivered"
    label: "Disclosure delivered"
    definition: "Required product disclosures have been presented to the
                 customer and receipt recorded."

terms:
  - id: "action:assess_suitability"
    label: "Assess suitability"
    consequence: reversible
    verifies:
      - claim: "suitability.assessed"
        whenResult: ok

  - id: "action:deliver_disclosure"
    label: "Deliver product disclosure"
    consequence: compensable
    verifies:
      - claim: "disclosure.delivered"
        whenResult: ok

  - id: "action:quote_rate"
    label: "Quote a rate"
    definition: "State a specific rate to the customer. Once stated it has been
                 heard; a correction is a further communication."
    consequence: irreversible
    recommendable: true
    binds:
      closeMatch: ["https://spec.edmcouncil.org/fibo/ontology/FND/Agreements/Agreements/Quotation"]

  - id: "action:open_account"
    label: "Open account"
    consequence: irreversible
    recommendable: false
```

Nothing here states that a quote requires a disclosure. That constraint may be mined from behaviour, written by a compliance team, or imposed by regulation — in all three cases it lives in a rule layer above ACV, and ACV's contribution is that such a rule can be *expressed and checked*, because `disclosure.delivered` is a claim that `action:deliver_disclosure` establishes.

### 12.3 Software engineering

```yaml
acv: "1.0"
id: "https://acme.example/acv/repo"
version: "7"
title: "Repository actions"
domain: "software-engineering"

claims:
  - id: "tests.passing"
    label: "Test suite passing"
    definition: "The project's test suite completed with no failures against
                 the current working tree."

terms:
  - id: "npm test"
    label: "Run test suite"
    consequence: none
    verifies:
      - claim: "tests.passing"
        whenResult: ok        # a failing run establishes nothing

  - id: "git commit"
    label: "Commit"
    consequence: reversible

  - id: "git push"
    label: "Push to remote"
    definition: "Publish commits to a shared remote. A force-push can rewrite
                 history, but collaborators may already have fetched."
    consequence: compensable

  - id: "npm publish"
    label: "Publish package"
    definition: "Publish to the public registry. Unpublishing is restricted and
                 the version number is permanently consumed."
    consequence: irreversible
    recommendable: false
```

The `whenResult: ok` on `npm test` is the whole point of §6.5 in one line.

---

## Appendix A — JSON Schema (Normative)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://acv-spec.org/schema/1.0/profile.json",
  "title": "ACV 1.0 Profile",
  "type": "object",
  "required": ["acv", "id", "version", "title", "terms"],
  "properties": {
    "acv": { "const": "1.0" },
    "id": { "type": "string", "format": "iri" },
    "version": { "type": "string", "minLength": 1 },
    "title": { "type": "string", "minLength": 1 },
    "description": { "type": "string" },
    "domain": { "type": "string" },
    "extends": {
      "type": "array",
      "items": { "type": "string", "format": "iri" }
    },
    "claims": {
      "type": "array",
      "items": { "$ref": "#/$defs/claim" }
    },
    "terms": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/$defs/term" }
    }
  },
  "$defs": {
    "claim": {
      "type": "object",
      "required": ["id", "label"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "label": { "type": "string", "minLength": 1 },
        "definition": { "type": "string" },
        "decaysAfter": {
          "type": "string",
          "pattern": "^P(?!$)(\\d+Y)?(\\d+M)?(\\d+D)?(T(?=\\d)(\\d+H)?(\\d+M)?(\\d+S)?)?$"
        }
      }
    },
    "term": {
      "type": "object",
      "required": ["id", "label", "consequence"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "label": { "type": "string", "minLength": 1 },
        "definition": { "type": "string" },
        "consequence": {
          "enum": ["none", "reversible", "compensable", "irreversible"]
        },
        "recommendable": { "type": "boolean" },
        "actor": { "enum": ["agent", "human", "system", "any"] },
        "verifies": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["claim"],
            "properties": {
              "claim": { "type": "string", "minLength": 1 },
              "whenResult": { "enum": ["ok", "failed", "any"] }
            }
          }
        },
        "binds": {
          "type": "object",
          "properties": {
            "exactMatch":  { "$ref": "#/$defs/iriArray" },
            "closeMatch":  { "$ref": "#/$defs/iriArray" },
            "broadMatch":  { "$ref": "#/$defs/iriArray" },
            "narrowMatch": { "$ref": "#/$defs/iriArray" }
          }
        }
      },
      "allOf": [
        {
          "if": {
            "properties": { "consequence": { "const": "irreversible" } },
            "required": ["consequence"]
          },
          "then": { "required": ["recommendable"] }
        }
      ]
    },
    "iriArray": {
      "type": "array",
      "items": { "type": "string", "format": "iri" }
    }
  }
}
```

Schema validation is necessary but not sufficient for conformance. The requirements of §5.3 (extension resolution, cycles, duplicate identifiers) and §6.5 (claim resolvability) are not expressible in JSON Schema and MUST be checked separately.

---

## Appendix B — JSON-LD context (Normative)

Applying this context makes any conforming profile an RDF graph. Producers MAY include it as `@context`; consumers that do not process RDF MUST ignore it.

```json
{
  "@context": {
    "acv":  "https://acv-spec.org/ns/1.0#",
    "skos": "http://www.w3.org/2004/02/skos/core#",
    "xsd":  "http://www.w3.org/2001/XMLSchema#",

    "id":            "@id",
    "title":         "acv:title",
    "description":   "acv:description",
    "domain":        "acv:domain",
    "version":       "acv:version",
    "extends":       { "@id": "acv:extends", "@type": "@id", "@container": "@set" },

    "terms":         { "@id": "acv:term",  "@container": "@set" },
    "claims":        { "@id": "acv:claim", "@container": "@set" },

    "label":         "skos:prefLabel",
    "definition":    "skos:definition",

    "consequence":   { "@id": "acv:consequence", "@type": "@vocab" },
    "none":          "acv:None",
    "reversible":    "acv:Reversible",
    "compensable":   "acv:Compensable",
    "irreversible":  "acv:Irreversible",

    "recommendable": { "@id": "acv:recommendable", "@type": "xsd:boolean" },
    "actor":         { "@id": "acv:actor", "@type": "@vocab" },

    "verifies":      { "@id": "acv:verifies", "@container": "@set" },
    "claim":         { "@id": "acv:establishes", "@type": "@id" },
    "whenResult":    { "@id": "acv:whenResult", "@type": "@vocab" },
    "decaysAfter":   { "@id": "acv:decaysAfter", "@type": "xsd:duration" },

    "binds":         "@nest",
    "exactMatch":    { "@id": "skos:exactMatch",  "@type": "@id", "@container": "@set" },
    "closeMatch":    { "@id": "skos:closeMatch",  "@type": "@id", "@container": "@set" },
    "broadMatch":    { "@id": "skos:broadMatch",  "@type": "@id", "@container": "@set" },
    "narrowMatch":   { "@id": "skos:narrowMatch", "@type": "@id", "@container": "@set" }
  }
}
```

---

## Appendix C — Relationship to existing specifications (Informative)

| Specification | Relationship |
|---|---|
| **OCEL 2.0** | Complementary. OCEL records event and object instances with qualified relations; ACV annotates the *event types* OCEL references. An OCEL `ocel:type` is a natural ACV term `id`. |
| **Agent Data Protocol** | Complementary. ADP standardises agent trajectory structure (actions: api / code / message). ACV declares consequence for the specific api actions an ADP trace contains. |
| **OpenTelemetry GenAI semantic conventions** | Complementary. OTel standardises agent telemetry emission; ACV supplies the consequence classification that telemetry alone cannot express. |
| **XES** | Complementary, older. ACV terms map to XES `concept:name` values. |
| **PROV-O** | Adjacent. PROV-O describes derivation and attribution of artefacts; ACV describes the pragmatics of action types. A profile is a `prov:Entity` and its provenance is properly expressed in PROV-O. |
| **SKOS** | Reused. `binds` uses SKOS mapping properties with SKOS semantics. |
| **FIBO, ISO 20022, schema.org Actions** | Binding targets. These define what things are; ACV declares what acting on them costs. |
| **BFO / ISO 21838-2, DOLCE, SUMO, gist** | Not required and not assumed. ACV takes no position on upper-ontological commitments. A profile MAY bind to terms that are BFO-aligned; nothing in ACV depends on it. |
| **DECLARE, AgentSpec, guardrail DSLs** | Consumers. These express constraints; ACV supplies the term-level facts their predicates presuppose. |
| **PDDL** | Adjacent but distinct. PDDL action schemas carry preconditions and effects for planning. ACV deliberately carries neither (Appendix D.1); the two address different problems and can coexist. |

---

## Appendix D — Design rationale and rejected features (Informative)

### D.1 Why no preconditions or requirements

The most requested addition will be a `requires` member — "this action requires that claim". It is excluded deliberately.

A profile that states requirements is a rule set, and rule sets have provenance, support, exceptions, and a lifecycle: they are authored by someone, they can be wrong, they can be measured, and they can be retired. Collapsing them into the vocabulary would give constraints the same unquestioned status as the vocabulary itself, which is exactly the failure this layer separation is designed to avoid.

The asymmetry is the whole design. A term declares what it **proves** (`verifies`) because that is a stable fact about the action. What any action **requires** is a claim about the world that must be justified, and it belongs where justification can be attached.

### D.2 Why `window` was removed

An earlier draft carried a `window` member (`episode` or `interaction`). It was removed because a window is a property of a *rule* — the scope over which its support was measured — not of a term. The same action participates in rules measured over different windows. Keeping it here would have forced a false choice at vocabulary-authoring time.

### D.3 Why `consequence` is a four-valued ordinal and not two booleans

An earlier draft had `consequential: boolean` and `reversibility: enum`. These are not independent: every consequential action has a reversibility and every non-consequential one does not. Collapsing them yields a single ordinal that consumers can threshold on — "mine at or above `compensable`", "gate at or above `compensable`" — which is exactly how consumers use it. Two fields invited inconsistent combinations with no defined meaning.

### D.4 Why binding is optional

Requiring every term to bind to a published vocabulary would make publication conditional on finding an appropriate IRI, which for most organisations is a research task. Optionality means a profile can be written in an afternoon using local strings, and enriched later. A vocabulary that is not written is worth nothing regardless of how well it would have aligned.

### D.5 Why claims are flat

Claims have no hierarchy, no conjunction, no negation. Every one of those is expressible in the rule layer, and adding them here would produce a second, weaker rule language inside the vocabulary — with all the ambiguity of two systems that can express overlapping things differently.

### D.6 Why unknown terms are treated as irreversible

The alternative — treating an undeclared term as harmless — makes the safety of the whole system depend on the completeness of a document that is, by construction, always incomplete. Fail-safe means a new action in a deployment is protected before anyone documents it, and the cost is a false alarm. That is the correct trade in every domain this specification targets.

---

## References

### Normative

- **[RFC 2119]** Bradner, S. *Key words for use in RFCs to Indicate Requirement Levels.* BCP 14, RFC 2119, March 1997.
- **[RFC 8174]** Leiba, B. *Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words.* BCP 14, RFC 8174, May 2017.
- **[JSON-SCHEMA]** *JSON Schema 2020-12.* https://json-schema.org/
- **[JSON-LD11]** *JSON-LD 1.1.* W3C Recommendation. https://www.w3.org/TR/json-ld11/
- **[SKOS]** *SKOS Simple Knowledge Organization System Reference.* W3C Recommendation. https://www.w3.org/TR/skos-reference/
- **[ISO 8601]** *Date and time — Representations for information interchange.*
- **[YAML12]** *YAML Ain't Markup Language 1.2.* https://yaml.org/spec/1.2.2/

### Informative

- **[OCEL2]** Berti, A., Koren, I., Adams, J.N., Park, G., Knopp, B., et al. *OCEL (Object-Centric Event Log) 2.0 Specification.* 2023. https://www.ocel-standard.org/
- **[PROV-O]** *PROV-O: The PROV Ontology.* W3C Recommendation. https://www.w3.org/TR/prov-o/
- **[ADP]** *Agent Data Protocol: Unifying Datasets for Diverse, Effective Fine-tuning of LLM Agents.* https://arxiv.org/abs/2510.24702
- **[OTEL-GENAI]** *OpenTelemetry GenAI semantic conventions.* https://opentelemetry.io/
- **[FIBO]** *Financial Industry Business Ontology.* EDM Council. https://spec.edmcouncil.org/fibo/
- **[ISO20022]** *ISO 20022 Financial Services — Universal financial industry message scheme.* https://www.iso20022.org/
- **[SCHEMA-ACTIONS]** *Schema.org Actions.* https://schema.org/docs/actions.html
- **[BFO]** *ISO/IEC 21838-2:2021 — Top-level ontologies — Basic Formal Ontology.*
- **[AGENTSPEC]** *AgentSpec: Customizable Runtime Enforcement for Safe and Reliable LLM Agents.* ICSE 2026.

---

## Change log

| Version | Date | Changes |
|---|---|---|
| 1.0-draft-20260829 | 2026-08-29 | First public draft. |
