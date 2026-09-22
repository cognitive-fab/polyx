# Security

Report a vulnerability to **licensing@cognitivefab.com** with `security` in
the subject. Do not open a public issue for it. You will get an
acknowledgement within five working days and a fix or a stated position
within thirty.

## What is in scope

polyx runs where the corpus is and makes exactly one kind of outbound call:
`src/ports/jev/` posts redacted text to the TypeSafe API when `POLYX_JEV_KEY`
is set and `polyx annotate`, `polyx calibrate … derive` or `polyx serve` is
run with a real, calibrated predicate declared. Everything else is local.
`polyx-lens` makes no network call under any configuration, and its build
fails if it could.

The things worth reporting:

- Any way customer text reaches a stored artefact or leaves the machine
  unredacted. `polyx annotate --dry-run` writes every payload that would be
  sent; `test/redaction.test.ts` and `test/annotate.test.ts` scan every
  stored file for seeded identifiers. A gap in either is a security bug.
- Any way a model call reaches the mining path. That breaks reproducibility,
  which is what a reviewer is trusting.
- Any way an unadjudicated rule is served, or an observed fact overwrites a
  caller's fact. The first is the human gate; the second is the safety
  invariant, and `test/invariant.test.ts` is its property test.
- The advisor and review servers bind to loopback by default. If you find a
  configuration in which they do not, report it.

## What is not

polyx is not a security control and does not claim to be. A predicate reading
a poisoned text will faithfully report what the poison says, and a rule mined
from a compromised history is a faithfully mined compromise. The
`runtime-gap-brief` in `docs/` says which half of the problem this addresses.
