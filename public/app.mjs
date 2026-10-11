import { calculateDCF, sensitivity } from './model.mjs';
const $ = id => document.getElementById(id);
let company = null, lastCalculation = null, loadVersion = 0, controller = null, edited = false;
const aliases = { NVIDIA: 'NVDA', '英伟达': 'NVDA', APPLE: 'AAPL', MICROSOFT: 'MSFT', GOOGLE: 'GOOGL' };
const normalize = raw => aliases[raw.trim().toUpperCase()] || raw.trim().toUpperCase();
const number = (n, digits = 3) => n === null || n === undefined ? '待核对' : n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const price = n => n < 0 ? '权益不足' : `$${number(n, 2)}`;
const pct = n => `${number(n * 100, 2)}%`;
const billion = n => n === null ? '待核对' : `${number(n / 1e9)}B`;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function safeLink(label, href) {
  const a = document.createElement('a'); a.textContent = label;
  try { if (new URL(href).protocol !== 'https:') throw new Error(); a.href = href; }
  catch { a.removeAttribute('href'); }
  a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function fillInputs() {
  for (const key of ['fcff', 'cash', 'debt', 'shares']) $(key).value = company[key] === null ? '' : company[key] / 1e9;
  $('discount').value = (company.discount * 100).toFixed(2);
  $('terminal').value = company.terminal * 100;
  $('adjustment').value = company.adjustment / 1e9;
  edited = false; updateAssumptions();
}
function updateAssumptions() {
  if (!company) return;
  $('assumptions').textContent = `${edited ? '已修改资料／假设 · ' : ''}5 年预测 · 折现率 ${$('discount').value || '待填'}%（${edited ? '可调整假设' : '行业参考'}） · 永续增长 ${$('terminal').value || '待填'}% · ${company.mode === 'snapshot' ? '财报快照' : '在线读取'}`;
}
function dirty() { $('results').hidden = true; $('calc-error').hidden = true; lastCalculation = null; }
function renderCompany(data) {
  company = data; edited = false; dirty();
  $('symbol').value = data.symbol;
  $('company').hidden = false;
  $('company-symbol').textContent = data.symbol;
  $('company-name').textContent = data.name;
  $('data-mode').textContent = data.mode === 'snapshot' ? '已保存的财报快照' : 'SEC 在线财报';
  $('data-mode').classList.toggle('snapshot', data.mode === 'snapshot');
  $('dates').textContent = `年度现金流：${data.period.end} · 资产负债：${data.balanceEnd} · 股数：${data.sharesEnd || '待核对'}`;
  const cards = [
    ['年度 FCFF 估算', billion(data.fcff), 'USD billion · 年度经营口径'],
    ['现金及短期金融投资', billion(data.cash), 'USD billion · 财报账面值'],
    ['有息债务', billion(data.debt), 'USD billion · 不含经营负债'],
    ['在外流通股数', billion(data.shares), '十亿股 · 非 public float']
  ];
  $('facts').replaceChildren(...cards.map(([title, text, unit]) => {
    const div = document.createElement('div'); div.className = 'fact';
    for (const [tag, val] of [['span', title], ['strong', text], ['small', unit]]) { const el = document.createElement(tag); el.textContent = val; div.append(el); }
    return div;
  }));
  $('missing').hidden = !data.missing.length;
  $('missing').textContent = `以下资料无法自动确认，请在进阶假设中核对后填写：${data.missing.join('；')}。缺失数值不会当作零。`;
  const meta = document.createElement('p'); meta.className = 'muted';
  meta.textContent = `行业：${data.industry} · 行业资本成本参考 ${pct(data.discount)}（${data.waccAsOf}） · 资料读取于 ${data.retrievedAt.slice(0, 10)}。${data.mode === 'snapshot' ? '快照不会随查询自动更新。' : '财报数字随公司披露更新，并非实时行情。'}`;
  $('sources').replaceChildren(safeLink('打开 SEC 财报 ↗', data.reportUrl), safeLink('行业资本成本来源 ↗', data.waccSource), meta);
  $('warnings').replaceChildren(...data.warnings.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  const tbody = $('audit').querySelector('tbody');
  tbody.replaceChildren(...data.audit.map(row => {
    const tr = document.createElement('tr');
    for (const text of [`${row.namespace}:${row.tag}`, row.start ? `${row.start} → ${row.end}` : row.end, number(row.val, 0) + (row.unit === 'shares' ? ' 股' : ' USD'), row.filed]) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    return tr;
  }));
  fillInputs();
  $('calc-button').disabled = false;
  if (data.missing.length) $('advanced').open = true;
}
async function snapshot(symbol, signal) {
  const response = await fetch(`./data/${encodeURIComponent(symbol)}.json`, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error('这个代码尚无财报快照。');
  const data = await response.json(); return { ...data, mode: 'snapshot' };
}
async function lookup(symbol) {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) { status('请输入有效美股代码，例如 NVDA。', true); return; }
  const version = ++loadVersion;
  controller?.abort(); controller = new AbortController();
  const activeController = controller;
  const { signal } = activeController;
  company = null; $('company').hidden = true; $('calc-button').disabled = true; dirty();
  $('load').disabled = true; $('load').textContent = '正在读取…';
  status(`正在读取 ${symbol} 的财报资料…`);
  try {
    let data, liveError;
    try {
      const apiBase = String(window.DCF_CONFIG?.apiBase || '').replace(/\/$/, '');
      if (!apiBase && location.hostname.endsWith('github.io')) throw new Error('在线财报服务尚未连接。');
      const url = new URL(`${apiBase}/api/company`, window.location.origin);
      url.searchParams.set('symbol', symbol);
      const timeout = setTimeout(() => activeController.abort(), 55000);
      try {
        const response = await fetch(url, { signal });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('当前网页没有连接在线财报服务。');
        const payload = await response.json();
        if (!response.ok) { const error = new Error(payload.error || '在线查询失败。'); error.status = response.status; throw error; }
        data = payload;
      } finally { clearTimeout(timeout); }
    } catch (error) {
      if (signal.aborted) throw error;
      if ([400, 404, 422].includes(error.status)) throw error;
      liveError = error.message;
      data = await snapshot(symbol, signal);
    }
    if (version !== loadVersion) return;
    renderCompany(data);
    status(data.mode === 'snapshot' ? `${liveError || '当前使用财报快照。'} 已载入 ${symbol} 的已保存资料，请留意财报日期。` : data.missing.length ? `${symbol} 的资料已读取，部分字段需要先在进阶假设中核对。` : `${symbol} 的财报资料已读取。填写你的增长假设，再计算。`);
  } catch (error) {
    if (version !== loadVersion) return;
    status(error.name === 'AbortError' ? '读取超时，请稍后重试。' : `${error.message} 可先试用 NVDA，或请管理员接上在线服务／更新快照。`, true);
    $('assumptions').textContent = '请先读取公司资料。';
  } finally {
    if (version === loadVersion) { $('load').disabled = false; $('load').textContent = '读取公司资料 ↗'; }
  }
}
function readInputs() {
  const input = {};
  for (const key of ['fcff', 'cash', 'debt', 'shares', 'discount', 'terminal', 'adjustment']) {
    if ($(key).value.trim() === '') throw new Error('请完整填写增长率及财务数值；缺失财报项目需先在进阶假设中核对。');
    const n = Number($(key).value);
    input[key] = ['discount', 'terminal'].includes(key) ? n / 100 : n * 1e9;
  }
  input.growthRates = [1, 2, 3, 4, 5].map(year => {
    const value = $(`growth-${year}`).value.trim();
    if (!value) throw new Error(`请填写第 ${year} 年的增长率。`);
    return Number(value) / 100;
  });
  return input;
}
function renderResults(input, result) {
  $('result-subtitle').textContent = `${company.symbol} · 五年增长 ${input.growthRates.map(pct).join(" → ")} · 折现率 ${pct(input.discount)} · 永续增长 ${pct(input.terminal)}${edited ? ' · 已调整输入' : ''}`;
  $('fair-value').textContent = price(result.price);
  $('ev').textContent = billion(result.operatingValue);
  $('equity').textContent = billion(result.equityValue);
  $('five-pv').textContent = billion(result.pvCashFlows);
  $('terminal-pv').textContent = billion(result.pvTerminal);
  $('five-bar').style.width = `${(1 - result.terminalShare) * 100}%`;
  $('terminal-bar').style.width = `${result.terminalShare * 100}%`;
  $('terminal-note').textContent = `${pct(result.terminalShare)} 的经营价值来自第五年之后。这个占比越高，越需要检查长期增长和折现率假设。`;
  const issues = [];
  if (result.equityValue < 0) issues.push('这些假设下普通股权益为负，不能将结果解释为负股价或交易信号。');
  if (input.terminal > 0.04) issues.push('永续增长高于 4%，请核对长期经济增长、币种与再投资需求是否支持这个假设。');
  if (input.discount - input.terminal < 0.02) issues.push('折现率与永续增长率相差不足 2 个百分点，终值会对微小变化非常敏感。');
  if (input.growthRates.some(growth => growth > 0.3)) issues.push('部分年度增长高于 30%，请说明业务及再投资依据，并比较较低增长情境。');
  $('result-warning').hidden = !issues.length; $('result-warning').textContent = issues.join(' ');
  $('forecast-rows').innerHTML = result.years.map(row => `<tr><td>第 ${row.year} 年</td><td>${pct(row.growth)}</td><td>${number(row.cashFlow / 1e9)}</td><td>${number(row.pv / 1e9)}</td></tr>`).join('') + `<tr class="total-row"><td>第五年之后</td><td>${pct(input.terminal)}</td><td>${number(result.terminalValue / 1e9)}</td><td>${number(result.pvTerminal / 1e9)}</td></tr>`;
  $('scenario-cards').innerHTML = [-0.05, 0, 0.05].map((shift, index) => {
    let val; const growthRates = input.growthRates.map(growth => growth + shift);
    try { val = price(calculateDCF({ ...input, growthRates }).price); } catch { val = '超出范围'; }
    return `<div class="scenario ${index === 1 ? 'current' : ''}"><span>${['较低增长', '你的假设', '较高增长'][index]}<small>${shift === 0 ? "保持各年输入" : `各年 ${shift > 0 ? "+" : "−"}5 个百分点`}</small></span><b>${val}</b></div>`;
  }).join('');
  const grid = sensitivity(input);
  $('sensitivity-table').innerHTML = `<thead><tr><th>折现率 ↓ ／ 永续增长 →</th>${grid[0].cells.map(c => `<th>${pct(c.terminal)}</th>`).join('')}</tr></thead><tbody>${grid.map((row, i) => `<tr><th>${pct(row.discount)}</th>${row.cells.map((cell, j) => `<td class="${i === 2 && j === 2 ? 'center' : ''}">${cell.price === null ? '不适用' : price(cell.price)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('results').hidden = false;
  lastCalculation = { input, result, company: structuredClone(company), edited };
  $('results').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
$('lookup').addEventListener('submit', e => { e.preventDefault(); lookup(normalize($('symbol').value)); });
document.querySelectorAll('[data-symbol]').forEach(button => button.addEventListener('click', () => lookup(button.dataset.symbol)));
$('symbol').addEventListener('input', () => {
  if (company && normalize($('symbol').value) !== company.symbol) { dirty(); $('calc-button').disabled = true; status('股票代码已改变，请先读取新公司的资料。'); }
  else if (company) $('calc-button').disabled = false;
});
$('calculate').noValidate = true;
$('calculate').addEventListener('submit', e => {
  e.preventDefault(); $('calc-error').hidden = true;
  try {
    if (!company || normalize($('symbol').value) !== company.symbol) throw new Error('请先读取当前股票代码的资料。');
    const input = readInputs(); renderResults(input, calculateDCF(input));
  } catch (error) { $('calc-error').textContent = error.message; $('calc-error').hidden = false; if (company?.missing.length) $('advanced').open = true; }
});
for (const year of [1, 2, 3, 4, 5]) $(`growth-${year}`).addEventListener('input', dirty);
for (const key of ['fcff', 'cash', 'debt', 'shares', 'discount', 'terminal', 'adjustment']) $(key).addEventListener('input', () => { edited = true; dirty(); updateAssumptions(); });
$('reset').addEventListener('click', () => { if (company) { fillInputs(); dirty(); } });
$('download').addEventListener('click', () => {
  if (!lastCalculation) return;
  const record = { createdAt: new Date().toISOString(), ...lastCalculation, note: '教育用途；不是目标价或交易指令。金额输入为 USD，股数为实际股数，增长率为小数。' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `DCF-${company.symbol}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('connection-note').textContent = window.DCF_CONFIG?.apiBase || !location.hostname.endsWith('github.io') ? '按「读取公司资料」查询在线财报，网页会显示资料日期。' : '目前为财报快照试用版；在线财报服务尚未连接，查询不会自动获取最新财报。';
// Initial snapshot makes the educational example usable without an online server.
const initialVersion = loadVersion;
snapshot('NVDA').then(data => { if (loadVersion === initialVersion) { renderCompany(data); status('已载入 NVIDIA 财报快照。按「读取公司资料」可尝试更新；填写增长假设即可试算。'); } }).catch(() => { if (loadVersion === initialVersion) status('输入美股代码，再按「读取公司资料」。'); });
