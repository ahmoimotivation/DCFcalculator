import { loadCompany, normalizeSymbol } from '../lib/sec.mjs';
const attempts = new Map();
export default async function handler(req, res) {
  const origin = req.headers.origin;
  const permitted = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && permitted.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: '只支持读取资料。' }); }
  const ip = req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  const entry = attempts.get(ip);
  const windowStart = entry && Date.now() - entry.start < 60000 ? entry : { start: Date.now(), count: 0 };
  windowStart.count += 1; attempts.set(ip, windowStart);
  if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
  if (windowStart.count > 12) return res.status(429).json({ error: '查询太频繁，请稍后再试。' });
  try {
    const symbol = normalizeSymbol(req.query?.symbol);
    const data = await loadCompany(symbol);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(200).json(data);
  } catch (error) { res.setHeader('Cache-Control', 'no-store'); return res.status(error.status || 502).json({ error: error.status ? error.message : '读取资料失败，请稍后重试。' }); }
}
