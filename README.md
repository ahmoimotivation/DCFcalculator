# F U MONEY · DCF 学生计算器

输入美股代码，自动读取 SEC 财报并填入财务数值；学生分别填写第一至第五年的 **FCFF 增长率** 后计算。中文界面，手机可用，无需学生注册或填写 API key。

## 目前能做什么

- 读取 USD / US-GAAP、10-K 与 10-Q 的公开财报；代码支持 `NVDA`，也接受 `NVIDIA`。
- 自动读取年度 FCFF 估算所需资料、最新可匹配的现金及短期投资、已披露有息债务、在外股数；保留每个原始 SEC 项目、期间、披露日期与财报链接。
- 自动填入 NYU Stern / Aswath Damodaran 的 **行业资本成本参考**。这不是公司专属 WACC。
- 五年预测、终值、每股估值、增长情境、折现率／永续增长率敏感度表与计算记录下载。
- 行业参考、永续增长率及所有财务输入可调整；修改后旧结果立即隐藏，需重新计算。
- 在线服务不可用时尝试有日期的财报快照；界面明确说明快照状态。
- 缺失资料保留为空，不会当作零。部分公司的标准 SEC 标签不足，需教师补充核对；不宣称覆盖所有美股。
- 默认不处理金融、房地产、ETF、外币报表及负 FCFF 估值。

现有快照：NVDA、AAPL、MSFT、AMD、GOOGL、AMZN、META、TSLA。**NVDA、AAPL、AMZN 的当前快照可直接用增长率试算；其余快照可能有需要人工核对的字段。** NVDA 本例采用 FY2026 的年度经营数据，最新资产负债表截至 2026-07-26、股数截至 2026-08-21；不是 TTM。

## 本地试用

需要 Node.js 22 或以上。不需要安装第三方依赖。

```sh
cp .env.example .env
# 在 .env 填 SEC_USER_AGENT=AhMoiDCF 你的真实联系邮箱
npm run dev
```

打开服务器打印的 Local 地址。没有 `.env` 时，快照仍可试用；按读取按钮会说明在线服务未配置。`PORT` 可调整。

```sh
npm test
```

测试包括独立推导的永续现金流结果、终值折现、债务及单位换算、无效输入，以及真实 NVDA 资料中的期间匹配、股数选择和债务去重。

## 放到 GitHub 与部署

将本目录内容放在仓库根目录；无需包含上层项目、其他站点或 `sources/` 文件。

### 方式 A：GitHub 仓库 + Vercel（完整在线查询）

1. 在 Vercel 导入这个 GitHub 仓库，Framework 选择 Other；使用仓库自带的 `vercel.json`，Output Directory 为 `public`，无构建／安装依赖要求。
2. 添加环境变量 `SEC_USER_AGENT`，内容为 `AhMoiDCF 你的真实联系邮箱`。SEC 要求自动请求识别应用及联系方式；它不是 API key，只在后端使用。
3. 部署。网页与 `/api/company?symbol=NVDA` 在同一个网站，学生只需输入代码和增长假设。

SEC 不支持浏览器跨域读取，因此本项目通过后端读取并缓存一小时；浏览器不会收到 `SEC_USER_AGENT`。SEC 可能限制数据中心 IP 或频繁请求，不保证任何部署区域都可直连；失败时用明确标记的已有快照。

### 方式 B：GitHub Pages（快照可直接使用）

1. GitHub 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
2. `.github/workflows/pages.yml` 将 `public/` 部署为 Pages。支持仓库子路径；不是把源码 HTML 直接当作在线 API。
3. 纯 Pages 只能查已保存的快照。若要查询其他股票，先部署上述后端，再把 `public/config.js` 中 `apiBase` 改为你的 Vercel 网站地址。
4. 若前端和后端不在同一个地址，在后端设置 `ALLOWED_ORIGINS` 为 GitHub Pages 的来源（如 `https://你的用户名.github.io`，不带仓库路径）。多个来源用逗号分隔。

### 更新快照

本地运行：

```sh
node scripts/update-wacc.mjs
npm run refresh
```

在 `scripts/symbols.json` 添加希望预存的股票代码。新增代码并不保证其所有标签都被自动支持。

仓库 Secrets 中设置 `SEC_USER_AGENT`，则 `.github/workflows/refresh.yml` 可手动执行或每周一马来西亚时间 06:30 更新 NYU 行业数据与 SEC 快照，再部署 Pages。失败时旧财务快照不被覆盖。GitHub Actions 的定时执行可能延迟；财报不是每日产生的新数据。这个工作流只适用于把本项目放在仓库根目录的情况。

公开网页无需密码，数据均来自公开财报。运行实例内有查询频率限制和缓存；大量学生并发使用时应增加平台级限流，必要时由教师扩展快照名单。

## 模型口径与重要限制

所有金额在计算时为 USD，界面输入为十亿美元；股数界面为十亿股。

```text
有效税率 = 年度所得税费用 / 同期税前利润
非现金营运资金代理 = 流动资产 − 现金及短期金融投资 − 流动负债 + 短期有息债务
FCFF 估算 = EBIT × (1 − 有效税率) + 折旧摊销 − 资本开支 − 营运资金代理增加额

FCFF_t = FCFF_(t−1) × (1 + 第 t 年增长率)，t = 1…5
终值_5 = FCFF_5 × (1 + 永续增长率) / (折现率 − 永续增长率)
经营价值 = Σ(FCFF_t / (1 + 折现率)^t) + 终值_5 / (1 + 折现率)^5
普通股权益 = 经营价值 + 现金及短期金融投资 − 有息债务 + 其他权益净调整
每股估值 = 普通股权益 / 在外流通股数
```

永续增长率必须低于折现率，默认 `2.5%` 仅是可修改的示例假设。负权益显示“权益不足”，不输出买卖信号。

- **FCFF 是估算**：广义营运资金包含部分非经营项目；并购、税率异常、一次性损益、资本化研发等需要专业调整。不得将本模型称为完整机构估值。
- 本版没有自动把公司 FCF 当作 FCFF，也不会把全部 current liabilities 作为债务扣除。页面原始资料中列出 OCF 和 CapEx，便于核对差异。
- 本版以年末折现，五年后立即进入稳定期，没有自动推导再投资率或增长逐步回落。这是教学用两阶段模型。
- 债务／投资采用财报金额近似；经营租赁作为经营费用处理。财务租赁、养老金、优先股、期权、股权激励稀释与少数股东权益并未完整建模。
- 现金及金融投资按已识别的短期／流动资产口径加入，未自动估计经营所需现金；长期非经营投资没有自动加入。教师需在“其他权益净调整”中合理处理。
- 股数采用披露的普通股在外股数，不用 public float 或 EPS 加权平均稀释股数。有多种股权类别时标准数据可能缺失；不会将单一类别误当全部股数。
- 折现率是 SIC 行业对应到 Damodaran 的行业参考；无法精确对应时采用美国非金融市场平均并提示。公司专属 WACC 需要公司 Beta、市场融资权重、债务成本和税率，当前并未自动推算。

## 资料来源

- [SEC EDGAR API 文档与访问要求](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [NYU Stern 行业资本成本](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html)，Aswath Damodaran；种子数据为 2026-01。
- [CFA Institute FCFF / FCFE 方法](https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/free-cash-flow-valuation)
- [Malaysia SC Finfluencer 资料](https://www.sc.com.my/investor-empowerment/info-on-finfluencer)

网页定位为财务教育与输入假设演示，不提供个别证券买入、卖出、持有建议，不保证回报。是否涉及受监管活动取决于实际使用、呈现和商业情境，不能仅凭免责声明判断。

## 文件结构

```text
public/              GitHub Pages / Vercel 网页与公开财报快照
api/company.mjs      在线股票查询接口
lib/sec.mjs          读取／核对 SEC 项目，推算年度 FCFF
scripts/             更新公开资料
tests/               估值计算与财报匹配测试
.github/workflows/   部署与数据刷新
```

本项目没有第三方运行依赖，不包含 API 密钥或管理者联系邮箱。管理者联系资料只存放在后台环境设置。

## 目前发布状态

GitHub Pages 网址：https://ahmoimotivation.github.io/DCFcalculator/ 。界面配色取自 FU Money Chapter 3 的黑、白、橙（#141414 / #EE6A1E / #CC5413）。五年各自输入增长率，按上一年 FCFF 连续复利。

GitHub Pages 已连接 https://dcfcalculator-livid.vercel.app 的财报后台，打开页面及按「读取公司资料」时查询最新已披露资料。后台失败时，只有预存股票可回退到带日期的快照；页面会明确标记。财报接口有一小时缓存，且 FCFF 当前仍是最新完整年度口径；WACC 是行业参考，不能宣称所有项目为实时公司数据。
