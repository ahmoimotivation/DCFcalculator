export function applyCompanyAssumptions(data, assumptions) {
  const evidence = assumptions?.scope === 'company' && assumptions.symbol === data.symbol ? assumptions : null;
  const discount = evidence?.discount?.kind === 'company-wacc-estimate' && Number.isFinite(evidence.discount.value) && evidence.discount.value > 0 && evidence.discount.value < 1 ? evidence.discount.value : null;
  const terminal = evidence?.terminal?.kind === 'published-company-model-assumption' && Number.isFinite(evidence.terminal.value) && evidence.terminal.value > -1 && evidence.terminal.value < 1 ? evidence.terminal.value : null;
  return { ...data, discount, terminal, valuationAssumptions: evidence, waccSource: evidence?.discount?.sourceUrl || null, waccAsOf: evidence?.discount?.asOf || null,
    warnings: (data.warnings || []).filter(w => !/行业.*(资本成本|折现率)|折现率.*行业/.test(w)) };
}
