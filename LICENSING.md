# Licensing

polyx is **source-available, not open source**, and this document says
exactly which parts are under which licence and why. The words matter: the
Business Source License is not OSI-approved, and nothing here calls it open
source.

## What is under which licence

| Component | Licence | Where |
|---|---|---|
| The lens — canonical record, ingest adapters, alphabets, the ports, redaction, the compliance report | **Apache-2.0** | [`polyx-lens`](https://github.com/cognitive-fab/polyx-lens), a separate package and repository |
| The miner, the store, the advisor, the review surface, the evaluation harness, the diff | **BUSL 1.1**, converting to Apache-2.0 four years after each version is published | this repository, `LICENSE` |
| The Jev adapter — client, observer, the annotation pass, calibration, the labelling page | **MIT** | `src/ports/jev/`, with its own `LICENSE` |
| Clause sets, gold alignments and other evaluation assets derived from private corpora | none — all rights reserved | not in any public repository, and `npm run check:shippable` fails the build if one appears here |

Public benchmark decompositions live in `polyx-bench` under Apache-2.0.
Datasets are never redistributed; `DATASETS.md` records the terms each was
used under.

## The BUSL grant

`LICENSE` is the Business Source License 1.1 with four parameters filled in.
The one that matters day to day is the **Additional Use Grant**: you may make
production use of polyx within your own organisation, on corpora your
organisation controls. What it does not permit is offering polyx to third
parties on a hosted, embedded or managed basis, or using it to produce rule
sets, expertise bundles or reports as a paid deliverable for others. Mining
your own corpus, adjudicating the rules, and serving them to your own agents
and staff are internal use.

Four years after a version is published it becomes Apache-2.0 automatically.
That is what the licence says about what happens if the licensor disappears,
and it is in writing rather than in an escrow agreement.

For terms other than the Additional Use Grant: licensing@cognitivefab.com.

## Why source-available rather than a binary

The miner has to run where the corpus is. An agent's logs at a bank cannot
leave the building, so the code was always going to ship as source or
something close to it — and obfuscation would cost the property the product
rests on: *no model call in the mining path, nothing leaves the machine, here
is the source*. The licence does the enforcing instead of the compiler.

## Why the lens is Apache-2.0

The free half answers a question without asking anything of the reader: a
corpus and a contract set go in, a compliance report comes out. No mining,
no store, no adjudication, no model call, and no network code — `npm run
check:offline` in that repository fails the build on any code that could
make a network call. Its value is adoption, and the licence follows.

The split is real rather than declared. `polyx-lens` is a separate package;
nothing in it imports polyx; the dependency runs one way, and
`npm run check:boundary` here enforces the other boundaries the split
depends on.

## Why the Jev adapter is MIT

`src/ports/jev/` is the second implementation of the observation port that
`polyx-lens` defines, and the only code in either package that makes a
network call. It is carved out of the BUSL grant — the `Licensed Work`
parameter names the exclusion, every file carries an SPDX header, and
`npm run check:notice` fails the build if either goes missing — for three
reasons.

**Its value is not in the code.** The adapter is a thin client: bearer auth,
a timeout, backoff on two status codes, and a map from the vendor's answer to
the port's `Observation`. What is worth paying for is the miner it feeds and
the calibration discipline around it. Licensing the client restrictively
would protect nothing and would make the one piece a customer most wants to
read — *what leaves my machine?* — the one piece they would have to ask about.

**It should be trivially replaceable.** The port exists so that a second
System One implementation, or a local classifier, drops in behind the same
interface. The reference adapter should be copyable into that second
implementation without a licence conversation, by anyone, including the
vendor.

**MIT rather than Apache-2.0** because the adapter is small enough that
Apache's NOTICE and patent machinery is weight without benefit, and because
MIT is the licence a reader expects on a vendor client.

## Rules that follow from this

**Nothing that went out under Apache-2.0 is ever relicensed.** Once the lens
is Apache-2.0, it stays Apache-2.0. New code may start under BUSL; existing
open code does not move.

**This is not called open source.** BUSL is not OSI-approved. The accurate
words are *source-available*, with an Apache-2.0 lens and an MIT adapter.

**The answer keys gate every shipment.** A clause set is an answer key, and a
shipped answer key is a shipped evaluation. They live in sibling checkouts,
are found through `POLYX_POLICIES` or `"policies"` in `polyx.config.json`,
and the tree may not contain one.

**Third-party attribution still applies.** `NOTICE` and `licenses/` carry the
Apache-2.0 attribution for `polyx-lens` and, through it, for polyness;
`npm run check:notice` fails the build without it.

**Contributions.** A contributor's work enters this repository under the same
terms as the rest of it. See `CONTRIBUTING.md`.
