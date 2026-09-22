// TS §11: same corpus + same alphabet version + same thresholds → byte-identical
// derived artefacts. Phase 0 pins the audit; Phase 2 extends this to the rule set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audit } from '@cognitive-fab/polyx-lens';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { tempWorkspace } from './helpers.ts';

test('audit twice, diff: identical', async () => {
  const a = tempWorkspace();
  const b = tempWorkspace();
  try {
    const ca = await loadCorpus(a.config, 'synthetic');
    const cb = await loadCorpus(b.config, 'synthetic');
    const ra = JSON.stringify(audit(ca, a.thresholds));
    const rb = JSON.stringify(audit(cb, b.thresholds));
    assert.equal(ra, rb);
    assert.equal(JSON.stringify(ca.interactions), JSON.stringify(cb.interactions));
  } finally {
    a.cleanup();
    b.cleanup();
  }
});
