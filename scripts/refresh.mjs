import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { loadCompany, normalizeSymbol } from '../lib/sec.mjs';
const root = new URL('../public/data/', import.meta.url);
try { process.loadEnvFile('.env'); } catch {}
if (!process.env.SEC_USER_AGENT) throw new Error('Set SEC_USER_AGENT to the application name and your real contact email.');
const symbols = JSON.parse(await readFile(new URL('./symbols.json', import.meta.url), 'utf8'));
await mkdir(root, { recursive: true });
let failures = 0;
for (const raw of symbols) {
  const symbol = normalizeSymbol(raw);
  try {
    const data = await loadCompany(symbol);
    data.mode = 'snapshot';
    await writeFile(new URL(`${symbol}.json`, root), JSON.stringify(data, null, 2) + '\n');
    console.log(`${symbol}: ${data.missing.length ? 'partial snapshot (missing values preserved)' : 'updated'} · FY ${data.period.end}`);
  } catch (error) { failures += 1; console.error(`${symbol}: ${error.message} · existing snapshot kept`); }
  await new Promise(resolve => setTimeout(resolve, 600));
}
if (failures) process.exitCode = 1;
