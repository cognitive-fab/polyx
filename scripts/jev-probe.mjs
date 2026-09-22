#!/usr/bin/env node
// W0.3 — print one whole answer object.
//
// The vendor describes two quantities per answer, "calibrated probabilities
// and confidence scores"; every probe run before this read `.noul` and
// discarded the rest without anyone looking. If a noul carries a second-order
// uncertainty of its own, it is a per-call detector for the quadrant-four
// case, where the separation gate is a per-calibration one — and the
// annotation store must retain it from the first pass or every corpus gets
// re-annotated later.
//
//   POLYX_JEV_KEY=… node scripts/jev-probe.mjs
//
// One call, two questions, the response printed verbatim. Nothing is written.
import { JevClient } from '../src/ports/jev/client.ts';

const key = process.env.POLYX_JEV_KEY;
if (!key) {
  console.error('POLYX_JEV_KEY is not set');
  process.exit(1);
}
const client = new JevClient({ key });
const state = 'My account was charged twice for the same order and nobody has explained why.';
const t0 = Date.now();
const r = await client.ask({
  state,
  model: 'jev-latest',
  questions: {
    states_double_charge: { type: 'noul', instructions: 'Does this message state that the customer was charged twice?', criteria: { true: 'A double charge is stated.', false: 'No double charge is stated.' } },
    states_a_reason: { type: 'noul', instructions: 'Does this message give a reason for what it asks?' },
  },
});
console.log(`${Date.now() - t0} ms`);
console.log(JSON.stringify(r, null, 2));
const extra = Object.entries(r.answers).flatMap(([k, a]) => Object.keys(a).filter((f) => f !== 'noul').map((f) => `${k}.${f}`));
console.log(extra.length ? `\nfields beyond noul: ${extra.join(', ')} — these are what Observation.raw retains` : '\nno field beyond noul: what we have been calling confidence is p, and the separation gate is the only quadrant-four detector');
