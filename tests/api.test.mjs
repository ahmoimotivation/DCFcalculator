import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/company.mjs';
test('a single allowed website keeps CORS headers when a non-browser request primes the cache', async () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://ahmoimotivation.github.io';
  try {
    for (const origin of [undefined, 'https://ahmoimotivation.github.io', 'https://example.com']) {
      const headers = {};
      const res = { setHeader(k,v) { headers[k] = v; }, status() { return this; }, json() {} };
      await handler({ method: 'POST', headers: { origin } }, res);
      assert.equal(headers['Access-Control-Allow-Origin'], 'https://ahmoimotivation.github.io');
      assert.equal(headers.Vary, 'Origin');
    }
  } finally { if (previous === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previous; }
});
