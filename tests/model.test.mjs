import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDCF, sensitivity } from '../public/model.mjs';
const input = { fcff: 100, cash: 50, debt: 20, shares: 10, growthRates: [0,0,0,0,0], discount: .1, terminal: 0, adjustment: 0 };
test('zero-growth perpetuity matches the independently derived 100 / 10% operating value', () => {
  const result = calculateDCF(input);
  assert.ok(Math.abs(result.operatingValue - 1000) < 1e-9);
  assert.ok(Math.abs(result.price - 103) < 1e-9);
  assert.equal(result.years[0].cashFlow, 100);
});
test('terminal cash flow is year 6 and terminal value is discounted back five years', () => {
  const result = calculateDCF({ ...input, growthRates: [.05,.05,.05,.05,.05], terminal: .02 });
  const expected = 100 * 1.05 ** 5 * 1.02 / .08;
  assert.ok(Math.abs(result.terminalValue - expected) < 1e-8);
  assert.ok(Math.abs(result.pvTerminal - expected / 1.1 ** 5) < 1e-8);
});
test('more debt lowers equity value exactly; units cancel correctly', () => {
  const base = calculateDCF(input);
  const adjusted = calculateDCF({ ...input, debt: 30 });
  assert.equal(base.price - adjusted.price, 1);
  const scaled = calculateDCF({ ...input, fcff: input.fcff * 1e9, cash: input.cash * 1e9, debt: input.debt * 1e9, shares: input.shares * 1e9 });
  assert.ok(Math.abs(base.price - scaled.price) < 1e-9);
});
test('rate singularity, zero shares, missing facts and negative cash flow cannot yield plausible values', () => {
  for (const change of [{ terminal: .1 }, { shares: 0 }, { fcff: null }, { debt: NaN }, { growthRates: [-1,0,0,0,0] }, { fcff: -10 }, { discount: 0 }]) assert.throws(() => calculateDCF({ ...input, ...change }));
});
test('higher discount lowers values; sensitivity central cell matches headline', () => {
  assert.ok(calculateDCF({ ...input, discount: .12 }).price < calculateDCF(input).price);
  assert.equal(sensitivity(input)[2].cells[2].price, calculateDCF(input).price);
});

test('each annual growth compounds from the previous year, including a decline', () => {
  const result = calculateDCF({ ...input, growthRates: [.2, .1, -.1, 0, .05] });
  const expected = [120,132,118.8,118.8,124.74];
  result.years.forEach((row,i) => assert.ok(Math.abs(row.cashFlow - expected[i]) < 1e-8));
  const expectedPV = expected.reduce((sum,c,i) => sum + c / 1.1 ** (i+1),0);
  assert.ok(Math.abs(result.pvCashFlows - expectedPV) < 1e-8);
  assert.ok(Math.abs(result.terminalValue - 1247.4) < 1e-8);
  for (const growthRates of [[], [0,0,0,0], [0,0,NaN,0,0], [0,0,null,0,0], [0,0,2.1,0,0]]) assert.throws(() => calculateDCF({...input,growthRates}));
});
