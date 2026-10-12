import { writeFile, readFile } from 'node:fs/promises';
import { loadCompanyAssumptions } from '../lib/company-assumptions.mjs';
const path = new URL('../public/data/company-assumptions.json', import.meta.url);
const previous = JSON.parse(await readFile(path,'utf8'));
for (const symbol of Object.keys(previous)) {
  const record = await loadCompanyAssumptions(symbol);
  if (record.discount) record.discount.mode = 'saved';
  if (record.terminal) record.terminal.mode = 'saved';
  previous[symbol] = record;
  console.log(`${symbol}: company WACC ${record.discount ? 'sourced' : 'missing'} · terminal ${record.terminal ? 'published model' : 'missing; no substituted average'}`);
}
await writeFile(path,JSON.stringify(previous,null,2)+'\n');
