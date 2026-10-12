// Reviewed choice for NVIDIA: pair the WACC and terminal assumptions from its
// published FCFF model. Never select a lower rate merely because it raises value.
export function preferPublishedCompanyModel(assumptions) {
  const t = assumptions?.terminal;
  if (assumptions?.symbol !== 'NVDA' || assumptions.scope !== 'company' || t?.provider !== 'Trefis' || t.modelBasis !== 'FCFF@WACC' || t.kind !== 'published-company-model-assumption' || !t.asOf || !Number.isFinite(t.modelDiscount) || t.modelDiscount <= 0 || t.modelDiscount >= 1 || !Number.isFinite(t.value) || t.value >= t.modelDiscount) return assumptions;
  const comparison = assumptions.discount?.provider !== 'Trefis' ? assumptions.discount : assumptions.discountComparison;
  return { ...assumptions, discountComparison: comparison || null, discount: {
    value: t.modelDiscount, provider: 'Trefis', label: 'Published FCFF model WACC',
    sourceUrl: t.sourceUrl, asOf: t.asOf, pageCreated: t.pageCreated, mode: t.mode,
    kind: 'company-wacc-estimate',
    method: 'NVIDIA 采用同公司 Trefis 已发布 FCFF 模型的 WACC，与终值假设配对；不是行业平均或市场共识。公开页面未提供可完整重现的 CAPM、债务成本与权重参数。'
  }, warnings: (assumptions.warnings || []).filter(w => !w.includes('来自不同估值资料')) };
}
export function applyCompanyAssumptions(data, assumptions) {
  assumptions = preferPublishedCompanyModel(assumptions);
  const evidence = assumptions?.scope === 'company' && assumptions.symbol === data.symbol ? assumptions : null;
  const discount = evidence?.discount?.kind === 'company-wacc-estimate' && Number.isFinite(evidence.discount.value) && evidence.discount.value > 0 && evidence.discount.value < 1 ? evidence.discount.value : null;
  const terminal = evidence?.terminal?.kind === 'published-company-model-assumption' && Number.isFinite(evidence.terminal.value) && evidence.terminal.value > -1 && evidence.terminal.value < 1 ? evidence.terminal.value : null;
  return { ...data, discount, terminal, valuationAssumptions: evidence, waccSource: evidence?.discount?.sourceUrl || null, waccAsOf: evidence?.discount?.asOf || null,
    warnings: (data.warnings || []).filter(w => !/行业.*(资本成本|折现率)|折现率.*行业/.test(w)) };
}
