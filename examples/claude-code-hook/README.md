# polyx as a Claude Code hook

Before a tool runs, ask polyx. If a rule the agent's own history supports
says something should have happened first and it has not, the tool does not
run and the model is told why — in the rule's own words, with the number
that backs it. Sixty lines, one hook, no change to the agent.

`test/hook.test.ts` runs this hook the way Claude Code runs it — a child
process, the event on stdin, the verdict as an exit code — against a real
advisor on loopback. This page cannot drift from the code.

## Why a hook, and why Claude Code

polyx's runtime contract is one call, made *before a consequential action*:

```
POST /advise  { operator, episode: { events: [...so far] }, contact: { events: [...the session] },
                considering: "action:git_push", consideringSlots: { ... } }
→ { verdict: "warn" | "recommend" | "clear" | "abstain", warnings, actions, abstention }
```

That is a `PreToolUse` hook. Claude Code hands the hook the session so far
(`transcript_path`) and the tool it is about to call (`tool_name`,
`tool_input`); exit code 2 blocks the tool and feeds stderr to the model.

Claude Code in particular because everything the integration needs already
exists here. `alphabet.cc.yaml` types Claude Code transcripts — that is the
`cc` corpus. The eight "load X before doing Y" instructions in
`docs/runtime-gap-brief.md` *are* PreToolUse guards. Mine your own
transcripts, adjudicate three rules, and the hook enforces them in your next
session.

## What the hook does

1. Reads the event from stdin.
2. Appends the pending tool call to the transcript as one more assistant
   record and runs the whole thing through polyx-lens's `cc` adapter, the
   alphabet, and the same segmenter the corpus was mined under. The hook never
   re-implements how a Bash command is split or how a verb is recognised; the
   pending call is typed exactly as it would have been typed after the fact,
   and "the episode so far" is the same object the rules were mined over.
3. One `POST /advise` per considered action, carrying the episode, the whole
   session so far as types and slots, and the considered action's own slots.
   The session is what a rule measured over the contact is checked against
   — the read that licenses an edit is usually several prompts back — and
   the slots are what "the same file" is compared on: redacted tokens, never
   the path. A Bash command with three segments is three considerations.
4. Acts on the verdict:

| verdict | the hook |
|---|---|
| `warn` | exit 2 — the tool does not run; the model sees *`polyx: Before you push, run the tests. (held 41/47, own@operator; action:run_tests has not happened yet in this episode)`* |
| `recommend` | allow, and hand the recommendation to the model as context |
| `clear` | allow, silently |
| `abstain` | allow, silently; with `POLYX_HOOK_VERBOSE=1`, log what would have resolved it |

Nothing about polyx is imported into the agent's process. The hook depends
on `polyx-lens` (Apache-2.0) to type the transcript and on `fetch` to reach
the advisor, which runs as its own process on loopback. The licence line sits
exactly where the architecture diagram draws it.

**It fails open.** A hook that blocked every tool when the advisor was down
would be hostile. An unreachable server allows the call and says so on stderr
once. `POLYX_HOOK_STRICT=1` fails closed.

## Run it

Against your own transcripts:

```
node corpora/link-cc.mjs                       # freeze your Claude Code sessions as the private `cc` corpus
node bin/polyx.mjs mine cc                     # candidate rules with evidence and counter-evidence
node bin/polyx.mjs review cc serve             # mark the ones you mean `real`; nothing else is served
node bin/polyx.mjs serve cc --port 7777        # the advisor, where the hook looks by default
```

Then register the hook. Put `settings.json` from this directory into
`.claude/settings.json` of the project you want guarded (or `~/.claude/` for
all of them), with the path made absolute:

```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
  "hooks": [ { "type": "command", "command": "node /path/to/polyx/examples/claude-code-hook/polyx-hook.mjs", "timeout": 5 } ] } ] } }
```

Rules are mined per project, so the same rule is one row per project it was
found in. To mean it for all of them, press **Real everywhere** (`E`) on the
review page, or `node bin/polyx.mjs review cc mark <rule-id> real --everywhere`:
each row it is proposed for is marked at its own support, and the rows left
alone — refused, already ruled on, standing behind another rule — are listed.
A project the rule was never mined for gets nothing; there is no evidence
there to record the verdict against.

The matcher is the set of tools that can be consequential. `Read`, `Grep`
and `Glob` are `none` in the alphabet and never a decision point; leaving
them out of the matcher saves a round trip that would always allow.

Without your own corpus, `test/hook.test.ts` shows the shape against the
sample transcripts that ship with polyx-lens and a planted rule.

## What the model sees

A push in a session where no tests have run:

```
polyx: Before you push, run the tests. (held 41/47, own@operator; action:run_tests has not happened yet in this episode)
```

An edit to a file nothing in the session read or wrote, under the same-file
rule (`no-X-without-prior-Y-same-S`, mined where the alphabet declares `file`
an identity):

```
polyx: Before you edit a file, read a file or write a file whole — the same file, earlier in the contact. (held 87/94, own@operator; action:read_file or action:write_file on the same file has not happened yet in this session)
```

The type-level rule, "read a file before you edit one", is satisfied by a read
of any file; this one is the edit made from a guess about a file never opened.
Both messages are asserted verbatim by `test/hook.test.ts`.

Each is the whole message. Not "you may not push" — polyx has no authority
and claims none — but "this has held forty-one times out of forty-seven in
your own history, and the thing it depends on has not happened yet". The
model can run the tests and push, or push anyway if the user asks, exactly as
it could before. What has changed is that the rule that was in a CLAUDE.md
nobody was counting is now a number the model sees at the moment it matters.

## The same three lines elsewhere

Any framework with a pre-tool seam is the same integration. What differs is
the alphabet — the hard part, and the part this example gets for free.

| framework | the seam | what the hook maps to |
|---|---|---|
| Claude Code | `PreToolUse` hook | this file |
| Claude Agent SDK | `hooks.PreToolUse` in `query()` options | the same script, called in-process |
| LangGraph | wrap the tool node, or `interrupt_before` | `considering` = the tool call about to execute; exit 2 → raise |
| OpenAI Agents SDK | a tool guardrail | `warn` → tripwire, with the rule text as the reason |
| Vercel AI SDK | tool middleware / `experimental_prepareStep` | `warn` → drop the tool call and inject the rule text |

In each case: type the trajectory so far with the framework's adapter, post
`considering`, act on the verdict. The verdict semantics — and the
three-valued abstention under them — do not change with the framework.

## Where observation fits

The hook sends each event's `text` alongside its type — what was said at that
turn, read by the adapter's own text source. On the server, `polyx serve`
redacts it under the corpus's text profile and, with `POLYX_JEV_KEY` set and a
real, calibrated predicate declared, observes it *before* the advisor answers.
A rule can then guard a tool call on what the user said: *"before you
force-push, the user must have asked for something irreversible"* is
checkable. Every observation is logged with its probability, so a live
period can be replayed later with no key.

With no key the text is ignored and the advisor answers over typed state
only, exactly as before; the decision log says `observer: null` so a
degraded period is visible rather than mistaken for corpus drift. The text
never reaches the log and never leaves the machine unredacted.

## Files

| | |
|---|---|
| `polyx-hook.mjs` | the hook |
| `settings.json` | the registration, path to be made absolute |
| `test/hook.test.ts` | runs the hook as Claude Code would, against a served rule |
| `src/serve/http.ts` | the advisor server the hook talks to |
| `polyx-lens/alphabets/alphabet.cc.yaml` | what a Claude Code session is typed as |
