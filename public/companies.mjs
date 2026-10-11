export const researchCompanies = [
  { symbol: 'NVDA', name: 'NVIDIA', group: 1, aliases: ['英伟达', '輝達', '辉达'] },
  { symbol: 'AMZN', name: 'Amazon', group: 1, aliases: ['亚马逊', '亞馬遜'] },
  { symbol: 'GOOGL', name: 'Google / Alphabet', group: 1, aliases: ['Google', 'Alphabet', '谷歌'] },
  { symbol: 'META', name: 'Meta', group: 1, aliases: ['Facebook', '脸书', '臉書'] },
  { symbol: 'JNJ', name: 'Johnson & Johnson', group: 1, aliases: ['Johnson and Johnson', '强生', '強生'] },
  { symbol: 'LLY', name: 'Eli Lilly', group: 1, aliases: ['Lilly', '礼来', '禮來'] },
  { symbol: 'NOW', name: 'ServiceNow', group: 2, aliases: ['Service Now'] },
  { symbol: 'AAPL', name: 'Apple', group: 2, aliases: ['苹果', '蘋果'] },
  { symbol: 'V', name: 'Visa', group: 2, aliases: ['维萨', '維薩'] },
  { symbol: 'UNH', name: 'UnitedHealth', group: 2, aliases: ['UnitedHealth Group', 'United Healthcare', '联合健康', '聯合健康'] },
  { symbol: 'TSM', name: '台积电 / TSMC', group: 2, aliases: ['台积电', '台積電', 'TSMC', 'Taiwan Semiconductor', 'Taiwan Semiconductor Manufacturing'] }
];
const others = [
  { symbol: 'MSFT', name: 'Microsoft', aliases: ['微软', '微軟'] },
  { symbol: 'AMD', name: 'AMD', aliases: ['超微', 'Advanced Micro Devices'] },
  { symbol: 'TSLA', name: 'Tesla', aliases: ['特斯拉'] },
  { symbol: 'COST', name: 'Costco', aliases: ['好市多'] },
  { symbol: 'NFLX', name: 'Netflix', aliases: ['奈飞', '網飛'] }
];
export const knownCompanies = [...researchCompanies, ...others];
const clean = text => String(text || '').trim().toUpperCase().replace(/[\s&/.,()'-]+/g, '');
export function resolveKnownCompany(query) {
  const term = clean(query);
  return knownCompanies.find(c => [c.symbol, c.name, ...c.aliases].some(name => clean(name) === term))?.symbol || null;
}
export function normalizeCompany(query) {
  return resolveKnownCompany(query) || String(query || '').trim().toUpperCase();
}
export function matchCompanies(query, directory = []) {
  const term = clean(query);
  if (!term) return [];
  const exact = resolveKnownCompany(query);
  const entries = new Map(knownCompanies.map(c => [c.symbol, { symbol: c.symbol, name: c.name, aliases: c.aliases }]));
  for (const c of directory) {
    if (entries.has(c.ticker)) entries.get(c.ticker).aliases = [...entries.get(c.ticker).aliases, c.title];
    else entries.set(c.ticker, { symbol: c.ticker, name: c.title, aliases: [] });
  }
  return [...entries.values()].map(c => {
    const names = [c.name, ...c.aliases].map(clean);
    const symbol = clean(c.symbol);
    const score = c.symbol === exact || symbol === term ? 0 : names.some(n => n === term) ? 1 : names.some(n => n.startsWith(term)) ? 2 : symbol.startsWith(term) ? 3 : names.some(n => n.includes(term)) ? 4 : 99;
    return { symbol: c.symbol, name: c.name, score };
  }).filter(c => c.score < 99).sort((a, b) => a.score - b.score || a.symbol.localeCompare(b.symbol)).slice(0, 8).map(({ symbol, name }) => ({ symbol, name }));
}
