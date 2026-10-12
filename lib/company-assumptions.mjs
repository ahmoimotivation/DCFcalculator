import saved from '../public/data/company-assumptions.json' with { type: 'json' };
const cache = new Map(), pending = new Map();
const clean = s => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function statistic(html, label) {
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (!clean(match[1]).includes(label)) continue;
    const cells = [...match[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) return null;
    const cell = cells.at(-1), exact = cell[1].match(/title="([^"]+)"/)?.[1] || clean(cell[2]);
    return /^-?\d+(?:\.\d+)?%?$/.test(exact) ? Number(exact.replace('%', '')) : null;
  }
  return null;
}
function sourceDate(html) {
  const m = clean(html).match(/Last updated:\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]) + 1;
  return month ? `${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
}
export function parseStatistics(html, symbol, sourceUrl) {
  const wacc = statistic(html, 'Weighted Average Cost of Capital (WACC)'), beta = statistic(html, 'Beta (5Y)'), roic = statistic(html, 'Return on Invested Capital (ROIC)'), growth = statistic(html, 'Revenue Growth Forecast (3Y)');
  const asOf = sourceDate(html);
  // Never treat an omitted/not-applicable statistic as zero or an industry fallback.
  const discount = Number.isFinite(wacc) && wacc > 0 && wacc < 100 && asOf ? { value: wacc / 100, provider: 'Stock Analysis / S&P Global Market Intelligence', label: 'Weighted Average Cost of Capital (WACC)', sourceUrl, asOf, mode: 'online', kind: 'company-wacc-estimate', method: '采用该公司公开 WACC 估算；供应商未公开可完整重现的利率、风险溢价、债务成本和权重参数。' } : null;
  return { discount, context: { beta5Y: beta, roic: roic === null ? null : roic / 100, revenueGrowthForecast3Y: growth === null ? null : growth / 100, sourceUrl, asOf } };
}
function jsonAssignment(html, name) {
  const start = html.match(new RegExp(`(?:const|var|let) ${name}\\s*=\\s*`));
  if (!start) return null;
  const offset = start.index + start[0].length;
  if (html[offset] !== '{') return null;
  let depth = 0, quote = false, escaped = false;
  for (let i = offset; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quote = false; continue; }
    if (c === '"') quote = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(offset, i + 1)); } catch { return null; } }
  }
  return null;
}
export function parseTerminalModel(html, symbol, sourceUrl) {
  const data = jsonAssignment(html, 'serverData'), page = jsonAssignment(html, 'pageMeta');
  const audit = data?.audit_trail_map, meta = data?.model_metadata;
  const value = audit?.Replica_Terminal_Growth;
  const years = meta?.forecast_years;
  const sourceSymbol = html.match(/(?:const|var|let) GEN_SYMBOL\s*=\s*"([A-Z0-9.-]+)"/)?.[1];
  if (sourceSymbol !== symbol) return null;
  if (meta?.is_ddm !== false || !Number.isFinite(value) || value <= -1 || value >= 1 || !audit?.Replica_Source_Updated || !Array.isArray(years) || !years.length) return null;
  return { value, provider: 'Trefis', label: 'Effective Terminal Growth', sourceUrl, asOf: audit.Replica_Source_Updated.slice(0,10), pageCreated: page?.created_at?.slice(0,10) || null, mode: 'online', kind: 'published-company-model-assumption', modelDiscount: Number.isFinite(audit.Replica_Discount_Rate) ? audit.Replica_Discount_Rate : null, forecastYears: years.length, method: '引用同一家公司的已发布 DCF 模型终值增长假设，不是管理层指引；完整终值经济参数没有在公开页面全部披露。' };
}
async function publicHTML(url, fetcher) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompanyResearch/1.0)', Accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('资料来源暂时不可用');
  const html = await response.text();
  if (html.length > 4000000) throw new Error('资料来源返回过大');
  return html;
}
export async function loadCompanyAssumptions(rawSymbol, { fetcher = fetch, now = new Date().toISOString() } = {}) {
  const symbol = String(rawSymbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('请输入有效美股代码。');
  const entry = cache.get(symbol);
  if (entry && Date.now() - entry.time < 3600000) return entry.value;
  if (pending.has(symbol)) return pending.get(symbol);
  const promise = (async () => {
    const fallback = saved[symbol];
    const statisticsURL = `https://stockanalysis.com/stocks/${symbol.toLowerCase()}/statistics/`;
    const modelURL = `https://www.trefis.com/data/valuation/${symbol}?from=interactiveAnalysis`;
    const results = await Promise.allSettled([publicHTML(statisticsURL, fetcher), publicHTML(modelURL, fetcher)]);
    let statistics = results[0].status === 'fulfilled' ? parseStatistics(results[0].value, symbol, statisticsURL) : null;
    let terminal = results[1].status === 'fulfilled' ? parseTerminalModel(results[1].value, symbol, modelURL) : null;
    if (!statistics?.discount && fallback?.discount) statistics = { discount: { ...fallback.discount, mode: 'saved' }, context: fallback.context };
    if (!terminal && fallback?.terminal) terminal = { ...fallback.terminal, mode: 'saved' };
    const warnings = [];
    if (!statistics?.discount) warnings.push('未取得这家公司的 WACC；保持空白，不采用行业或市场平均。');
    if (!terminal) warnings.push('未取得可核对的公司专属终值增长模型；保持空白，不能用行业平均或统一 2.5% 补填。');
    if (terminal) warnings.push(`来源模型预测 ${terminal.forecastYears} 年；本工具预测五年后即进入稳定期，适用性需要另行判断。`);
    warnings.push('WACC 与终值增长率来自不同估值资料；只引用参数，不复现任何来源网站的完整估值。');
    const value = { symbol, scope: 'company', checkedAt: now, discount: statistics?.discount || null, terminal, context: statistics?.context || fallback?.context || null, warnings };
    cache.set(symbol, { time: Date.now(), value });
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return value;
  })();
  pending.set(symbol, promise);
  try { return await promise; } finally { pending.delete(symbol); }
}
