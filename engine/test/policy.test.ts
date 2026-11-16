import { test } from 'node:test';
import assert from 'node:assert/strict';
import seed from '../../server/policies/v5.0.json' with { type: 'json' };
import { validatePolicy, policyDiff } from '../src/policy.js';

test('hand-authored v5 policy validates and includes all routes', () => {
  const p = validatePolicy(seed);
  assert.equal(p.rules.length, 7); assert.equal(p.version, '5.0');
  assert.equal(Object.keys(p.route_registry).length, 7);
});
test('policy rejects unknown facts, references, duplicate order and unsafe PO strategy', () => {
  for (const mutate of [
    (p: typeof seed) => { p.rules[0].when = { fact: 'unknown', operator: 'eq', value: true } as typeof p.rules[0]['when']; },
    (p: typeof seed) => { delete (p.parameters as Record<string, number>).spot_limit_inr; },
    (p: typeof seed) => { p.rules[1].order = p.rules[0].order; },
    (p: typeof seed) => { p.route_registry.SPOT_PO.supplier_strategy = 'none'; },
  ]) { const p = structuredClone(seed); mutate(p); assert.throws(() => validatePolicy(p)); }
});
test('policy diff exposes a changed threshold and inserted plant rule', () => {
  const a = validatePolicy(seed), b = structuredClone(a);
  b.parameters.spot_limit_inr += 1;
  b.rules.splice(4, 0, { id: 'plant-limit', clause: 'amendment', order: 45, when: { fact: 'plant', operator: 'eq', value: 'TEST_PLANT' }, outcome: { route: 'RFQ' } });
  const diff = policyDiff(a, validatePolicy(b));
  assert.ok(diff.some(d => d.includes('parameters.spot_limit_inr')));
  assert.ok(diff.some(d => d.includes('plant-limit')));
});
