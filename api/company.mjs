import { loadCompany, normalizeSymbol, searchCompanies } from '../lib/sec.mjs';
import { loadCompanyAssumptions } from '../lib/company-assumptions.mjs';
const attempts = new Map();
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const permitted = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  // A single fixed browser origin is safe to cache even when a server-side request fills the CDN first.
  if (permitted.length === 1) res.setHeader('Access-Control-Allow-Origin', permitted[0]);
  else if (origin && permitted.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  const responseCache = permitted.length > 1 ? 'private, max-age=300' : 'public, max-age=300, s-maxage=3600';
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: '只支持读取资料。' }); }
  const searchRequest = req.query?.q !== undefined;
  const assumptionsRequest = req.query?.assumptions === '1';
  const ip = `${req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown'}:${searchRequest ? 'search' : assumptionsRequest ? 'assumptions' : 'data'}`;
  const entry = attempts.get(ip);
  const windowStart = entry && Date.now() - entry.start < 60000 ? entry : { start: Date.now(), count: 0 };
  windowStart.count += 1; attempts.set(ip, windowStart);
  if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
  if (windowStart.count > (searchRequest ? 60 : 12)) return res.status(429).json({ error: '查询太频繁，请稍后再试。' });
  try {
    if (req.query?.q !== undefined) {
      const result = await searchCompanies(req.query.q);
      res.setHeader('Cache-Control', responseCache);
      return res.status(200).json(result);
    }
    const symbol = normalizeSymbol(req.query?.symbol);
    if (assumptionsRequest) {
      const data = await loadCompanyAssumptions(symbol);
      res.setHeader('Cache-Control', responseCache);
      return res.status(200).json(data);
    }
    const data = await loadCompany(symbol);
    res.setHeader('Cache-Control', responseCache);
    return res.status(200).json(data);
  } catch (error) { res.setHeader('Cache-Control', 'no-store'); return res.status(error.status || 502).json({ error: error.status ? error.message : '读取资料失败，请稍后重试。' }); }
}
