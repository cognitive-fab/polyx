// F4.3 / TS §7.5: identity excludes support; conditions are a set; bindings
// and window are identity.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, ruleId, type IdentityInput } from '../src/store/identity.ts';

const base: IdentityInput = {
  family: 'obligation',
  pattern: 'X-implies-prior-Y',
  bindings: { subject: 'action:quote_rate', guard: 'action:disclose_terms' },
  conditions: [
    { fact: 'product.type', op: 'eq', value: 'mortgage' },
    { fact: 'customer.tenure_months', op: 'gte', value: 12 },
  ],
  window: 'episode',
};

test('identity is stable and independent of key and condition order', () => {
  const a = ruleId(base);
  const reordered: IdentityInput = {
    window: 'episode',
    conditions: [base.conditions[1]!, base.conditions[0]!],
    bindings: { guard: 'action:disclose_terms', subject: 'action:quote_rate' },
    pattern: base.pattern,
    family: base.family,
  };
  assert.equal(ruleId(reordered), a);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('identity changes with bindings, conditions, window, pattern or family', () => {
  const a = ruleId(base);
  assert.notEqual(ruleId({ ...base, bindings: { ...base.bindings, guard: 'action:verify_identity' } }), a);
  assert.notEqual(ruleId({ ...base, conditions: base.conditions.slice(0, 1) }), a);
  assert.notEqual(ruleId({ ...base, window: 'interaction' }), a);
  assert.notEqual(ruleId({ ...base, pattern: 'at-most-one-X' }), a);
  assert.notEqual(ruleId({ ...base, family: 'recommendation' }), a);
});

test('`in` values are a set', () => {
  const a = ruleId({ ...base, conditions: [{ fact: 'p', op: 'in', value: ['a', 'b'] }] });
  const b = ruleId({ ...base, conditions: [{ fact: 'p', op: 'in', value: ['b', 'a'] }] });
  assert.equal(a, b);
});

test('canonicalJson sorts keys at every depth', () => {
  assert.equal(canonicalJson({ b: { d: 1, c: [3, { z: 1, y: 2 }] }, a: null }), '{"a":null,"b":{"c":[3,{"y":2,"z":1}],"d":1}}');
});
