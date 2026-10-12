import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractCompany, normalizeSymbol, pickFact } from '../lib/sec.mjs';
const fixture = JSON.parse(await readFile(new URL('./nvda-fixture.json', import.meta.url)));
const { facts, submissions } = fixture;
test('NVDA real filing: financial balance does not use public float or EPS weighted average shares', () => {
  const data = extractCompany(facts, submissions, 'NVDA');
  assert.equal(data.balanceEnd, '2026-07-26');
  assert.equal(data.shares, 24100000000);
  assert.equal(data.debt, 33366000000);
  assert.equal(data.cash, 99369000000);
  assert.equal(data.period.end, '2026-01-25');
  assert.equal(data.missing.length, 0);
  assert.equal(data.discount, null); // A filing does not supply a company WACC.
  assert.equal(data.terminal, null); // No common 2.5% substitute.
  assert.equal(data.components.simpleFCF, 96676000000);
  assert.notEqual(data.fcff, data.components.simpleFCF);
});
test('cash flow facts must have exactly the same reporting period', () => {
  const changed = structuredClone(facts);
  for (const row of changed.facts['us-gaap'].DepreciationDepletionAndAmortization.units.USD) row.start = '1900-01-01';
  assert.equal(extractCompany(changed, submissions, 'NVDA').fcff, null);
});
test('missing investments or debt is never silently treated as zero', () => {
  const changed = structuredClone(facts);
  delete changed.facts['us-gaap'].DebtSecuritiesCurrent;
  const data = extractCompany(changed, submissions, 'NVDA');
  assert.equal(data.cash, null);
  assert.equal(data.fcff, null);
  assert.ok(data.missing.length >= 2);
});
test('total debt aggregate avoids double-counting its current portion', () => {
  const changed = structuredClone(facts);
  delete changed.facts['us-gaap'].LongTermDebtNoncurrent;
  assert.equal(extractCompany(changed, submissions, 'NVDA').debt, 33366000000);
});
test('financial firms blocked; symbol validation disallows arbitrary outbound URLs', () => {
  assert.throws(() => extractCompany(facts, { ...submissions, sic: '6021' }, 'BANK'));
  assert.throws(() => normalizeSymbol('https://example.com'));
  assert.equal(normalizeSymbol('nvidia'), 'NVDA');
  assert.equal(normalizeSymbol(' brk.b '), 'BRK.B');
});
test('quarterly facts are not used in place of annual cash flows and restatements use latest disclosure', () => {
  const fact = pickFact(facts, ['OperatingIncomeLoss'], { start: '2025-01-27', end: '2026-01-25' });
  assert.equal(fact.val, 130387000000);
  assert.equal(fact.start, '2025-01-27');
});

test('CFO fallback uses matched annual interest and tax, never a quarterly interest amount', () => {
  const changed = structuredClone(facts);
  delete changed.facts['us-gaap'].DepreciationDepletionAndAmortization;
  changed.facts['us-gaap'].InterestExpenseNonoperating = { units: { USD: [{ start: '2025-01-27', end: '2026-01-25', val: 259000000, filed: '2026-02-25', form: '10-K' }] } };
  const data = extractCompany(changed, submissions, 'NVDA');
  assert.equal(data.fcffMethod, 'cfo-after-tax-interest');
  assert.ok(Math.abs(data.fcff - (102718000000 + 259000000 * (1 - 21383000000 / 141450000000) - 6042000000)) < 1);
  changed.facts['us-gaap'].InterestExpenseNonoperating.units.USD[0].start = '2025-10-27';
  assert.equal(extractCompany(changed, submissions, 'NVDA').fcff, null);
});
