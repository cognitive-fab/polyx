# polyx

Mine the rules an agent's own history supports, and serve them back with abstention. Any agent whose decisions are recorded as typed actions with a declared consequence: the evaluation corpora are customer service (ABCD, τ²-bench) and a bank's loan origination process (BPIC 2017, no dialogue and no conversational agent at all).

Source-available under the Business Source License 1.1, converting to Apache-2.0 four years after each version is published; production use within your own organisation is granted. The front half, `polyx-lens`, is Apache-2.0 and the Jev adapter is MIT. `LICENSING.md` says what is under which and why. This is not an open-source licence, and it is not called one. Contributions: `CONTRIBUTING.md`; vulnerabilities: `SECURITY.md`.

- `docs/polyx-functional-spec.md` — what and why
- `docs/polyx-technical-spec.md` — how
- `docs/polyx-implementation-plan.md` — in what order, with gates

## Run

Node ≥ 22.18 (TypeScript is run directly under Node's type stripping, unflagged from 22.18 / 23.6; `npm run build` emits `dist/`).

```
npm install
npm run ci                       # typecheck, boundary check, notice check, tests
node bin/polyx.mjs audit synthetic
node bin/polyx.mjs audit synthetic --show unknown
node bin/polyx.mjs alphabet show synthetic action:issue_refund
node bin/polyx.mjs mine abcd                       # candidate rules with evidence, counter-evidence, provenance
node bin/polyx.mjs review abcd serve               # the reviewer's page: one rule per screen
node bin/polyx.mjs evaluate abcd                   # precision / recall / refusal correctness against the abcd clause set
node bin/polyx.mjs evaluate abcd --sweep "minInstances=5,10,30"
node bin/polyx.mjs mine abcd --scope-by flow       # cross-flow provenance
```

`polyx-lens` installs from npm. To work on both at once, clone
[`polyx-lens`](https://github.com/cognitive-fab/polyx-lens) beside this
repository and `npm link ../polyx-lens`; after any change there, `npm run
build` there before polyx sees it.

Observing a fact the typed record cannot see — a System One model as an
observation port, wired in so that it can add a fact and can never assert an
absence — is `examples/jev-observation/README.md`. Ten minutes, no key; the
test suite runs every command on that page.

```
node bin/polyx.mjs predicates synthetic-observable
node bin/polyx.mjs annotate synthetic-observable --dry-run       # the redacted payloads; sends nothing
node bin/polyx.mjs annotate synthetic-observable --import node_modules/polyx-lens/fixtures/synthetic-observable/synthetic-observable@1.jsonl
node bin/polyx.mjs mine synthetic-observable --threshold minInstances=3
node bin/polyx.mjs coverage synthetic-observable                 # 5 abstentions resolved; nothing else can move
```

polyx inside an agent: `examples/claude-code-hook/` is a `PreToolUse` hook
that asks the advisor before a tool runs and blocks it, in the rule's own
words with its support, when a real rule says something should have happened
first. Sixty lines, no change to the agent; the same three lines map onto any
framework with a pre-tool seam, and the README there shows four.

Corpora: `node corpora/fetch-abcd.mjs`; `git clone https://github.com/sierra-research/tau2-bench corpora/tau2-src && node corpora/link-tau2.mjs`; `git clone https://huggingface.co/datasets/choucsan/mimo-claude-code-traces-1k corpora/mimo-src` (`cc-mimo`); `node corpora/link-cc.mjs` freezes your own Claude Code transcripts as the private `cc` corpus.

Corpora are configured in `polyx.config.json`; alphabets live in `alphabets/`; derived artefacts go to `.polyx/` (gitignored). Every run writes a manifest — corpus revision, alphabet version, thresholds, seed, commit — and every printed figure expands to its source records with `--show`.

## Layout

The front half is a separate Apache-2.0 package, `polyx-lens`: the canonical
record, the alphabet, the ingest adapters, the three ports and the free
compliance report. polyx depends on it and nothing in it imports polyx, so the
licence boundary is a dependency direction rather than a promise.

```
polyx-lens/        (Apache-2.0, separate repository)
  src/record.ts    canonical record + validator
  src/ingest/      adapters → raw interactions
  src/alphabet/    typing, redaction, outcome classification (alphabet.<corpus>.yaml)
  src/ports/       segmentation / subjects / provenance; two implementations each
  src/lens/        contract sets, the clause checker, the report
  contracts/       what a harness publishes about itself, decomposed

src/
  ports/jev/       the vendor: client, observer, the annotation pass, calibration — the only network code
  mine/            obligation and recommendation patterns
  store/           SQLite schema, rule identity, adjudication
  serve/           advisor
  evaluate/        conformance harness — the only place the answer key may be read
  diff/            three-region report
  cli/
alphabets/         reviewed, versioned, committed (in polyx-lens: alphabet.*, predicates.*, text.*)
examples/          runnable walkthroughs; the test suite runs their commands
                   (clause sets are NOT here — see polyx-eval and LICENSING.md)
corpora/           gitignored; fetch scripts only
scripts/           CI checks: boundary, NOTICE
test/              fixtures/synthetic is the planted-rule test oracle
```

## Standing rules

- No module outside `src/evaluate`, `src/diff`, `src/cli` may reach a clause set. `npm run check:boundary` enforces it.
- The clause sets and gold alignments are not in this repository at all. Public benchmark decompositions live in `polyx-bench` (Apache-2.0), clause sets from private corpora in `polyx-eval` (licensed to nobody); both are found through `POLYX_POLICIES` or `"policies"` in `polyx.config.json`. `npm run check:shippable` fails the build if one appears here. Without those checkouts, polyx audits and mines and skips evaluation.
- No polyx module outside `src/ports/polyness/` imports a polyness symbol.
- No LLM call in the mining path. Same corpus + alphabet + thresholds → identical rule set.
- Nothing is served that a human has not adjudicated `real`.
