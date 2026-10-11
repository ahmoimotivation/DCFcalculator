import { writeFile } from 'node:fs/promises';
const source = 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html';
const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error('Cannot refresh industry capital costs; retained data is unchanged.');
const html = await response.text();
const clean = str => str.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const text = clean(html);
const dateMatch = text.match(/Data used is as of\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
if (!dateMatch) throw new Error('Cannot identify dataset date; retained data is unchanged.');
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const asOf = `${dateMatch[2]}-${String(months.indexOf(dateMatch[1].toLowerCase()) + 1).padStart(2, '0')}`;
const industries = {};
for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
  if (cells.length >= 10 && /^\d+(\.\d+)?%$/.test(cells.at(-1))) industries[cells[0]] = Number(cells.at(-1).slice(0, -1));
}
if (Object.keys(industries).length < 50 || !industries.Semiconductor || !industries['Total Market (without financials)']) throw new Error('Unexpected dataset structure; retained data is unchanged.');
await writeFile(new URL('../public/data/wacc.json', import.meta.url), JSON.stringify({ asOf, source, attribution: 'Aswath Damodaran, NYU Stern', industries }, null, 2) + '\n');
console.log(`Industry cost-of-capital data: ${asOf}, ${Object.keys(industries).length} industries.`);
