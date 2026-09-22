# Contributing

polyx is source-available under the Business Source License 1.1, with an
Apache-2.0 front half (`polyx-lens`) and an MIT vendor adapter
(`src/ports/jev/`). Before anything else, read `LICENSING.md`: it says what is
under which licence and why, and a contribution lands under the licence of the
directory it lands in.

## What a contribution agrees to

By opening a pull request you confirm that you wrote the change or have the
right to submit it, and that it may be distributed under the licence that
covers the files it touches — BUSL 1.1 here, Apache-2.0 in `polyx-lens`, MIT
under `src/ports/jev/`. Add `Signed-off-by:` to your commits (the Developer
Certificate of Origin, `git commit -s`); that is the whole of the paperwork.

## What will not be merged

- Anything that puts a model call in the mining path. Same corpus, alphabet,
  thresholds and annotation file must give the same rule set byte for byte.
  `npm run check:boundary` fails the build; do not work around it.
- Anything that lets `polyx-lens` make a network call under any configuration.
  `npm run check:offline` there fails the build.
- A clause set, gold alignment, or any other evaluation asset. They are answer
  keys and they never enter the tree; `npm run check:shippable` fails the
  build.
- A change to a fixture's JSON by hand. `fixtures/*/generate.mjs` produces it;
  the counts it produces are asserted across both repositories.
- A closed-world shortcut: a fact absent from the record is `unknown`, never
  `false`, anywhere.

## How to work here

- Two packages, one built. polyx reads `polyx-lens` through its `dist/`, so
  after any change there, `npm run build` there before polyx sees it. Run
  `npm run ci` in both before you consider anything done.
- Comments explain *why*, cite the requirement id (`F6.4`, `JT4.2`), and
  record what was measured. Match the density of the file you are in.
- One change, one commit, a message that says why. The messages in this
  repository are short essays; match them.
- The examples are tests. `examples/*/README.md` quote real output and the
  test suite runs the same commands; change the code and the page changes in
  the same commit, or CI goes red.

`CLAUDE.md` in each repository is the longer version of this list, written
for an agent and true for a person.

## Reporting a problem

Bugs and questions: open an issue. Anything security-related: see
`SECURITY.md` and do not open an issue.
