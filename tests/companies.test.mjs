import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchCompanies, resolveKnownCompany, researchCompanies } from '../public/companies.mjs';
import { calculateDCF } from '../public/model.mjs';
const presets = JSON.parse(await readFile(new URL('../public/data/course-presets.json', import.meta.url)));
test('Chinese, English, punctuation and one-letter Visa code identify the intended company', () => {
  for (const [query, symbol] of [[' 台積電 ', 'TSM'], ['Johnson & Johnson', 'JNJ'], ['Service Now', 'NOW'], ['谷歌', 'GOOGL'], ['微软', 'MSFT'], ['visa', 'V']]) assert.equal(resolveKnownCompany(query), symbol);
  assert.equal(matchCompanies('V')[0].symbol, 'V');
});
test('non-course names search the directory; ambiguous names preserve choices instead of selecting arbitrarily', () => {
  const directory = [{ ticker: 'COST', title: 'COSTCO WHOLESALE CORP' }, { ticker: 'KO', title: 'COCA-COLA CO' }, { ticker: 'KOF', title: 'COCA COLA FEMSA SAB DE CV' }];
  assert.equal(matchCompanies('wholesale', directory)[0].symbol, 'COST');
  assert.deepEqual(new Set(matchCompanies('coca cola', directory).map(c => c.symbol)), new Set(['KO', 'KOF']));
  assert.equal(matchCompanies('does not exist', directory).length, 0);
});
test('the entire course roster has presets; eligible companies produce finite values with explicit student assumptions', () => {
  assert.equal(researchCompanies.length, 11);
  for (const c of researchCompanies) {
    const p = presets[c.symbol]; assert.ok(p, c.symbol);
    assert.ok(p.period.end >= '2025-09-01', `${c.symbol} must not silently use old annual facts`);
    for (const key of ['cash', 'debt', 'shares', 'discount', 'terminal']) assert.ok(Number.isFinite(p[key]), `${c.symbol}:${key}`);
    if (p.modelBlocked) { assert.equal(c.symbol, 'UNH'); assert.equal(p.fcff, null); continue; }
    assert.ok(p.fcff > 0);
    const result = calculateDCF({ ...p, growthRates: [.1, .09, .08, .07, .06] });
    assert.ok(Number.isFinite(result.price));
  }
});
test('TSM denominator represents all common shares in ADS units, not public float', () => {
  assert.equal(presets.TSM.shares * 5, 25932524520);
  assert.ok(presets.TSM.warnings.some(w => w.includes('USD／ADS')));
});
