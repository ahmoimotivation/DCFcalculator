import waccData from '../public/data/wacc.json' with { type: 'json' };
import { normalizeCompany, matchCompanies } from '../public/companies.mjs';

export class DataError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
const secCache = new Map();
const inflight = new Map();
export function normalizeSymbol(value) {
  const result = normalizeCompany(value);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(result)) throw new DataError('请输入美股代码，例如 NVDA、AAPL 或 MSFT。', 400);
  return result;
}
async function getSEC(url, userAgent, fetcher = fetch) {
  if (!userAgent || !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(userAgent)) throw new DataError('管理员尚未设置 SEC 联系标识；可先使用已保存的财报快照。', 503);
  const cached = secCache.get(url);
  if (cached && Date.now() - cached.time < 60 * 60 * 1000) return cached.value;
  if (inflight.has(url)) return inflight.get(url);
  const promise = (async () => {
    let response;
    try { response = await fetcher(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
    catch { throw new DataError('财报来源暂时无法连接，请稍后重试。', 502); }
    if (!response.ok) throw new DataError(response.status === 403 || response.status === 429 ? 'SEC 暂时限制访问，请稍后重试或使用财报快照。' : '暂时无法读取这家公司的财报。', 502);
    let value;
    try { value = await response.json(); } catch { throw new DataError('财报来源返回了无法识别的资料。', 502); }
    secCache.set(url, { time: Date.now(), value });
    if (secCache.size > 60) secCache.delete(secCache.keys().next().value);
    return value;
  })();
  inflight.set(url, promise);
  try { return await promise; } finally { inflight.delete(url); }
}
const days = (start, end) => (Date.parse(end) - Date.parse(start)) / 86400000;
const allowed = row => ['10-K', '10-K/A', '10-Q', '10-Q/A'].includes(row.form) && Number.isFinite(row.val);
function rows(facts, tag, unit = 'USD', ns = 'us-gaap') {
  return (facts.facts?.[ns]?.[tag]?.units?.[unit] || []).filter(allowed);
}
export function pickFact(facts, tags, { end, start, unit = 'USD', ns = 'us-gaap' } = {}) {
  for (const tag of tags) {
    const matches = rows(facts, tag, unit, ns).filter(row => (!end || row.end === end) && (start ? row.start === start : !row.start));
    matches.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    if (matches[0]) return { ...matches[0], tag, namespace: ns, unit };
  }
  return null;
}
const value = row => row?.val ?? null;
function addFacts(...facts) { return facts.every(Boolean) ? facts.reduce((sum, f) => sum + f.val, 0) : null; }
function debtAt(facts, end) {
  const current = pickFact(facts, ['DebtCurrent'], { end });
  const longCurrent = pickFact(facts, ['LongTermDebtCurrent'], { end });
  const shortBorrowings = pickFact(facts, ['ShortTermBorrowings', 'ShortTermDebtCurrent', 'CommercialPaper'], { end });
  const noncurrent = pickFact(facts, ['LongTermDebtNoncurrent'], { end });
  const aggregateLong = pickFact(facts, ['LongTermDebt'], { end });
  let short = value(current);
  if (short === null && longCurrent && shortBorrowings) short = longCurrent.val + shortBorrowings.val;
  // A reported aggregate is preferable to inventing an absent debt component.
  let total = null;
  const components = [];
  if (current && noncurrent) { total = current.val + noncurrent.val; components.push(current, noncurrent); }
  else if (longCurrent && shortBorrowings && noncurrent) { total = longCurrent.val + shortBorrowings.val + noncurrent.val; components.push(longCurrent, shortBorrowings, noncurrent); }
  else if (aggregateLong && current && longCurrent) { total = aggregateLong.val + current.val - longCurrent.val; components.push(aggregateLong, current, longCurrent); }
  else if (aggregateLong && shortBorrowings) { total = aggregateLong.val + shortBorrowings.val; components.push(aggregateLong, shortBorrowings); }
  return { short, total, components };
}
function liquidAt(facts, end) {
  const cash = pickFact(facts, ['CashAndCashEquivalentsAtCarryingValue'], { end });
  const combined = pickFact(facts, ['CashCashEquivalentsAndShortTermInvestments'], { end });
  const investments = pickFact(facts, ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesCurrent'], { end });
  // NVDA changed from combined marketable securities to debt/equity disclosure.
  const debtSecurities = pickFact(facts, ['DebtSecuritiesCurrent'], { end });
  const equitySecurities = pickFact(facts, ['EquitySecuritiesFvNi'], { end });
  if (combined) return { total: combined.val, cash, components: [combined] };
  if (cash && investments) return { total: cash.val + investments.val, cash, components: [cash, investments] };
  if (cash && debtSecurities && equitySecurities) return { total: addFacts(cash, debtSecurities, equitySecurities), cash, components: [cash, debtSecurities, equitySecurities] };
  return { total: null, cash, components: cash ? [cash] : [] };
}
function workingCapitalAt(facts, end) {
  const assets = pickFact(facts, ['AssetsCurrent'], { end });
  const liabilities = pickFact(facts, ['LiabilitiesCurrent'], { end });
  const liquid = liquidAt(facts, end);
  const debt = debtAt(facts, end);
  if (!assets || !liabilities || liquid.total === null || debt.short === null) return null;
  return { val: assets.val - liquid.total - liabilities.val + debt.short, end, components: [assets, liabilities, ...liquid.components, ...debt.components] };
}
export function industryFor(sic) {
  const code = Number(sic);
  if (code >= 6000 && code <= 6999) return { blocked: true, name: '金融／房地产' };
  const exact = { 3674: 'Semiconductor', 3559: 'Semiconductor Equip', 3571: 'Computers/Peripherals', 3572: 'Computers/Peripherals', 7370: 'Software (System & Application)', 7371: 'Software (System & Application)', 7372: 'Software (System & Application)', 7374: 'Software (Internet)', 3711: 'Auto & Truck', 2834: 'Drugs (Pharmaceutical)', 2836: 'Drugs (Biotechnology)', 4813: 'Telecom. Services', 5311: 'Retail (General)', 5961: 'Retail (General)', 5411: 'Retail (Grocery and Food)', 5812: 'Restaurant/Dining', 1311: 'Oil/Gas (Production and Exploration)', 2911: 'Oil/Gas (Integrated)', 7389: 'Business & Consumer Services' };
  return { name: exact[code] || 'Total Market (without financials)', approximate: !exact[code] };
}
export function extractCompany(facts, submissions, symbol, { retrievedAt = new Date().toISOString(), wacc = waccData } = {}) {
  const industry = industryFor(submissions.sic);
  if (industry.blocked) throw new DataError('银行、保险、金融与房地产公司需要专用估值模型，这版计算器不自动估值。');
  const annuals = ['OperatingIncomeLoss', 'NetCashProvidedByUsedInOperatingActivities'].flatMap(tag => rows(facts, tag).map(row => ({ ...row, tag }))).filter(row => row.start && ['10-K', '10-K/A'].includes(row.form) && days(row.start, row.end) >= 330 && days(row.start, row.end) <= 380);
  annuals.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const annual = annuals[0];
  if (!annual) throw new DataError('未找到可匹配的美元年度经营资料。这版暂不支持该公司的报表口径。');
  const period = { end: annual.end, start: annual.start };
  const ebit = pickFact(facts, ['OperatingIncomeLoss'], period);
  const pretax = pickFact(facts, ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'], period);
  const tax = pickFact(facts, ['IncomeTaxExpenseBenefit'], period);
  const depreciation = pickFact(facts, ['DepreciationDepletionAndAmortization', 'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment', 'DepreciationAndAmortization'], period);
  const capex = pickFact(facts, ['PaymentsToAcquireProductiveAssets', 'PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireOtherPropertyPlantAndEquipment'], period);
  const annualCFO = pickFact(facts, ['NetCashProvidedByUsedInOperatingActivities'], period);
  const interest = pickFact(facts, ['InterestExpenseNonoperating', 'InterestAndDebtExpense', 'InterestExpense'], period);
  const previousDate = new Date(Date.parse(annual.start) - 86400000).toISOString().slice(0, 10);
  const currentWC = workingCapitalAt(facts, annual.end);
  const previousWC = workingCapitalAt(facts, previousDate);
  const taxRate = pretax?.val > 0 && tax && tax.val >= 0 && tax.val <= pretax.val ? tax.val / pretax.val : null;
  const deltaWC = currentWC && previousWC ? currentWC.val - previousWC.val : null;
  const ebitFCFF = ebit && taxRate !== null && depreciation && capex && deltaWC !== null ? ebit.val * (1 - taxRate) + depreciation.val - capex.val - deltaWC : null;
  const cfoFCFF = taxRate !== null && annualCFO && interest && capex ? annualCFO.val + interest.val * (1 - taxRate) - capex.val : null;
  const fcff = ebitFCFF ?? cfoFCFF;
  const fcffMethod = ebitFCFF !== null ? 'ebit-working-capital' : cfoFCFF !== null ? 'cfo-after-tax-interest' : null;
  const latestBalance = pickFact(facts, ['AssetsCurrent']);
  const balanceEnd = latestBalance?.end || annual.end;
  const liquid = liquidAt(facts, balanceEnd);
  const debt = debtAt(facts, balanceEnd);
  const shares = pickFact(facts, ['EntityCommonStockSharesOutstanding'], { unit: 'shares', ns: 'dei' }) || pickFact(facts, ['CommonStockSharesOutstanding'], { unit: 'shares' });
  const sectorRate = wacc.industries[industry.name] ?? wacc.industries['Total Market (without financials)'];
  const missing = [];
  if (fcff === null) missing.push('年度 FCFF：缺少可匹配的税率、折旧、资本开支或营运资金资料');
  if (liquid.total === null) missing.push('现金及短期金融投资：无法确认完整口径');
  if (debt.total === null) missing.push('有息债务：无法确认完整口径');
  if (!shares) missing.push('在外流通股数');
  const audit = [ebit, pretax, tax, depreciation, capex, annualCFO, ...(fcffMethod === 'cfo-after-tax-interest' ? [interest] : []), ...liquid.components, ...debt.components, shares, ...(currentWC?.components || []), ...(previousWC?.components || [])].filter(Boolean);
  const uniqueAudit = [...new Map(audit.map(f => [`${f.namespace}:${f.tag}:${f.start || ''}:${f.end}`, f])).values()];
  const recent = submissions.filings?.recent;
  const reportIndex = recent?.reportDate?.findIndex((date, i) => date === balanceEnd && ['10-K', '10-Q'].includes(recent.form[i]));
  const accession = reportIndex >= 0 ? recent.accessionNumber[reportIndex] : latestBalance?.accn || annual.accn;
  const primaryDocument = reportIndex >= 0 ? recent.primaryDocument[reportIndex] : '';
  const cik = String(facts.cik || submissions.cik).replace(/^0+/, '');
  const reportUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll('-', '')}/${primaryDocument}`;
  const warnings = [
    '折现率自动采用行业资本成本参考，并非这家公司的专属 WACC。',
    fcffMethod === 'cfo-after-tax-interest' ? 'FCFF 按同一完整年度的 OCF＋税后利息费用−资本开支估算；不能把供应商直接列出的 FCF 当作 FCFF。' : 'FCFF 按年度 EBIT、有效税率、折旧、资本开支和广义非现金营运资金变动估算；与公司公布的 OCF−CapEx 不同。',
    '营运资金为流动资产−现金及短期金融投资−流动负债＋短期有息债务的代理口径，可能包含非经营项目与并购影响。',
    '按账面金额近似债务及现金投资价值；经营租赁保留为经营费用，未再次当债务扣除。',
    '使用实际在外股数；未单独估值期权、认股权证、少数股东权益和长期非经营资产，可在进阶假设中调整。'
  ];
  if (industry.approximate) warnings.push('行业无法精确对应，折现率使用美国非金融市场平均值。');
  if (fcffMethod === 'cfo-after-tax-interest') warnings.push('因 EBIT 口径所需字段不完整，本次 FCFF 改用同一完整年度的经营现金流＋税后利息费用−资本开支；不等同供应商直接列出的 FCF，股票薪酬与其他非现金调整需要另行核对。');
  if (fcff !== null && fcff <= 0) warnings.push('FCFF 为负数或零，需要不同的经营预测模型。');
  return { symbol, name: submissions.name || facts.entityName, currency: 'USD', mode: 'live', retrievedAt, period: { start: annual.start, end: annual.end, filed: annual.filed }, balanceEnd, sharesEnd: shares?.end, sic: submissions.sic, sicDescription: submissions.sicDescription, fcff, fcffMethod, cash: liquid.total, debt: debt.total, shares: value(shares), discount: sectorRate / 100, terminal: 0.025, adjustment: 0, industry: industry.name, waccAsOf: wacc.asOf, waccSource: wacc.source, reportUrl, missing, warnings, components: { ebit: value(ebit), taxRate, depreciation: value(depreciation), capex: value(capex), interest: value(interest), deltaWorkingCapital: deltaWC, workingCapital: currentWC?.val ?? null, previousWorkingCapital: previousWC?.val ?? null, cfo: value(annualCFO), simpleFCF: annualCFO && capex ? annualCFO.val - capex.val : null }, audit: uniqueAudit };
}
export async function loadCompany(rawSymbol, { userAgent = process.env.SEC_USER_AGENT, fetcher = fetch } = {}) {
  const symbol = normalizeSymbol(rawSymbol);
  const tickers = await getSEC('https://www.sec.gov/files/company_tickers.json', userAgent, fetcher);
  const company = Object.values(tickers).find(row => row.ticker === symbol || row.ticker === symbol.replace('.', '-'));
  if (!company) throw new DataError('SEC 目录中找不到这个代码，请确认是美国上市公司。', 404);
  const cik = String(company.cik_str).padStart(10, '0');
  // Sequential requests keep a visitor below SEC's fair-access limit.
  const submissions = await getSEC(`https://data.sec.gov/submissions/CIK${cik}.json`, userAgent, fetcher);
  const facts = await getSEC(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, userAgent, fetcher);
  return extractCompany(facts, submissions, symbol);
}
export async function searchCompanies(query, { userAgent = process.env.SEC_USER_AGENT, fetcher = fetch } = {}) {
  const term = String(query || '').trim();
  if (!term || term.length > 80) throw new DataError('请输入 1 至 80 个字的公司名称或股票代码。', 400);
  const tickers = await getSEC('https://www.sec.gov/files/company_tickers.json', userAgent, fetcher);
  return { query: term, matches: matchCompanies(term, Object.values(tickers)) };
}
