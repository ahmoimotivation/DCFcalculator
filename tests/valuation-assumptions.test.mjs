import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyCompanyAssumptions } from '../public/valuation-assumptions.mjs';
import { parseStatistics, parseTerminalModel, loadCompanyAssumptions } from '../lib/company-assumptions.mjs';
const seeds = JSON.parse(await readFile(new URL('../public/data/company-assumptions.json',import.meta.url)));
test('NVIDIA and Amazon use their own published company WACC and separately attributed terminal assumptions', () => {
  assert.ok(Math.abs(seeds.NVDA.discount.value-.16332)<1e-12);
  assert.ok(Math.abs(seeds.AMZN.discount.value-.11341)<1e-12);
  assert.equal(seeds.NVDA.terminal.value,.025);
  assert.equal(seeds.AMZN.terminal.value,.0275);
  assert.match(seeds.NVDA.discount.sourceUrl,/nvda/);
  assert.match(seeds.AMZN.terminal.sourceUrl,/AMZN/);
  assert.equal(seeds.NVDA.terminal.kind,'published-company-model-assumption');
});
test('unsupported terminal sources stay missing; stale industry and 2.5% defaults cannot leak into results', () => {
  const legacy = { symbol:'NOW',discount:.0934,terminal:.025,warnings:['折现率自动采用行业资本成本参考，并非这家公司的专属 WACC。'] };
  const data = applyCompanyAssumptions(legacy,seeds.NOW);
  assert.equal(data.terminal,null);
  assert.notEqual(data.discount,.0934);
  assert.equal(data.warnings.length,0);
  assert.equal(applyCompanyAssumptions(legacy,seeds.NVDA).discount,null);
  assert.equal(applyCompanyAssumptions(legacy,null).terminal,null);
});
test('the statistics parser preserves provider precision and source date and never interprets N/A as zero', () => {
  const html='<table><tr><td>Weighted Average Cost of Capital (WACC)</td><td title="16.332%">16.33%</td></tr><tr><td>Beta (5Y)</td><td title="2.216">2.22</td></tr></table><p>Last updated: <span>Oct 11, 2026</span></p>';
  const data=parseStatistics(html,'NVDA','https://stockanalysis.com/stocks/nvda/statistics/');
  assert.ok(Math.abs(data.discount.value-.16332)<1e-12);assert.equal(data.discount.asOf,'2026-10-11');assert.equal(data.context.beta5Y,2.216);
  assert.equal(parseStatistics(html.replace('title="16.332%">16.33%','>n/a'),'NVDA','').discount,null);
});
test('terminal parser requires the intended company, a dated published cash-flow model and real parameter', () => {
  const model={ model_metadata:{is_ddm:false,forecast_years:[2027,2028,2029,2030,2031,2032,2033]},audit_trail_map:{Replica_Terminal_Growth:.025,Replica_Discount_Rate:.09,Replica_Source_Updated:'2026-08-27T08:30:21Z'},notes:'brace }; in a string cannot end the JSON prematurely'};
  const html=`const serverData = ${JSON.stringify(model)}; const pageMeta = {"created_at":"2026-09-17T16:33:37Z"}; var GEN_SYMBOL = "NVDA";`;
  assert.equal(parseTerminalModel(html,'NVDA','').value,.025);
  assert.equal(parseTerminalModel(html,'AMZN',''),null);
  assert.equal(parseTerminalModel(html.replace('"is_ddm":false','"is_ddm":true'),'NVDA',''),null);
  assert.equal(parseTerminalModel(html.replace('"Replica_Terminal_Growth":0.025,',''),'NVDA',''),null);
});
test('source outages retain dated same-company records, with no industry substitute for a new ticker', async () => {
  const fetcher=async()=>{ throw new Error('unavailable'); };
  const data=await loadCompanyAssumptions('NVDA',{fetcher});
  assert.equal(data.discount.mode,'saved');assert.equal(data.discount.asOf,seeds.NVDA.discount.asOf);
  assert.equal(data.terminal.value,seeds.NVDA.terminal.value);
  const missing=await loadCompanyAssumptions('ZZZZ',{fetcher});
  assert.equal(missing.discount,null);assert.equal(missing.terminal,null);
  await assert.rejects(loadCompanyAssumptions('https://example.com',{fetcher}));
});
