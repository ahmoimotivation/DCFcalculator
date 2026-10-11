export function calculateDCF(input) {
  const keys = ['fcff', 'cash', 'debt', 'shares', 'discount', 'terminal', 'adjustment'];
  for (const key of keys) if (typeof input[key] !== 'number' || !Number.isFinite(input[key])) throw new Error('请完整填写数值，不能留空。');
  const { fcff, cash, debt, shares, discount: r, terminal: g, growthRates, adjustment } = input;
  if (fcff <= 0) throw new Error('基准 FCFF 必须为正数。负现金流公司需要逐年经营预测，不适用这版增长率模型。');
  if (cash < 0 || debt < 0 || shares <= 0) throw new Error('现金、债务不能为负；股数必须大于零。');
  if (r <= 0 || r > 1 || g <= -1 || g >= r) throw new Error('折现率需大于零，且永续增长率必须小于折现率。');
  if (!Array.isArray(growthRates) || growthRates.length !== 5 || growthRates.some(growth => typeof growth !== 'number' || !Number.isFinite(growth) || growth <= -1 || growth > 2)) throw new Error('请填写五个年度的增长率，每年需大于 −100%，且不超过 200%。');
  let value = fcff, pvCashFlows = 0;
  const years = Array.from({ length: 5 }, (_, i) => {
    value *= 1 + growthRates[i];
    const pv = value / (1 + r) ** (i + 1);
    pvCashFlows += pv;
    return { year: i + 1, growth: growthRates[i], cashFlow: value, pv };
  });
  const terminalValue = value * (1 + g) / (r - g);
  const pvTerminal = terminalValue / (1 + r) ** 5;
  const operatingValue = pvCashFlows + pvTerminal;
  const equityValue = operatingValue + cash - debt + adjustment;
  const price = equityValue / shares;
  if (![price, terminalValue, operatingValue].every(Number.isFinite)) throw new Error('假设导致计算超出范围，请调整数值。');
  return { years, terminalValue, pvTerminal, pvCashFlows, operatingValue, equityValue, price, terminalShare: pvTerminal / operatingValue };
}

export function sensitivity(input) {
  return [-0.02, -0.01, 0, 0.01, 0.02].map(delta => {
    const discount = input.discount + delta;
    return { discount, cells: [-0.01, -0.005, 0, 0.005, 0.01].map(shift => {
      const terminal = input.terminal + shift;
      try { return { terminal, price: calculateDCF({ ...input, discount, terminal }).price }; }
      catch { return { terminal, price: null }; }
    }) };
  });
}
