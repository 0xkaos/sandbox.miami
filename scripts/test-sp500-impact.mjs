import assert from 'node:assert/strict';
import { handleSp500Impact } from '../worker.js';

const NOW = new Date('2026-05-27T15:30:00.000Z');

class MockBucket {
  constructor(initial = {}) {
    this.objects = new Map(Object.entries(initial));
  }

  async get(key) {
    if (!this.objects.has(key)) return null;
    return { body: this.objects.get(key) };
  }

  async put(key, value) {
    this.objects.set(key, String(value));
  }
}

function request(method) {
  return new Request('https://sandbox.test/api/sp500-impact', { method });
}

async function responseJson(response) {
  return response.json();
}

function makeFetcher({ holdings, quotes, failHoldings = false, failQuotes = false, calls = [] }) {
  return async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    assert.equal(url.includes('test-key'), false, 'API key must not be placed in the URL');

    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/etf/holdings')) {
      if (failHoldings) return new Response('holdings unavailable', { status: 500 });
      return Response.json(holdings);
    }

    if (parsed.pathname.endsWith('/batch-quote')) {
      if (failQuotes) return new Response('quotes unavailable', { status: 503 });
      const symbols = new Set((parsed.searchParams.get('symbols') || '').split(','));
      return Response.json(quotes.filter((quote) => symbols.has(quote.symbol)));
    }

    return new Response('not found', { status: 404 });
  };
}

const holdings = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', weightPercentage: 7.1 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', weightPercentage: 6.8 },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', weightPercentage: 1.2 },
  { symbol: 'BAD', name: 'Malformed Holding', weightPercentage: null }
];

const quotes = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: 200, changesPercentage: 1.5, change: 3 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', price: 420, changesPercentage: -1, change: -4.2 },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', price: 110, changesPercentage: 2, change: 2.2 },
  { symbol: 'BAD', name: 'Malformed Quote', price: 12 }
];

async function testNoCache() {
  const response = await handleSp500Impact(request('GET'), { BUCKET: new MockBucket() });
  const body = await responseJson(response);
  assert.equal(response.status, 404);
  assert.equal(body.code, 'NO_CACHE');
}

async function testMissingSecret() {
  const calls = [];
  const response = await handleSp500Impact(
    request('POST'),
    { BUCKET: new MockBucket() },
    { now: NOW, fetcher: makeFetcher({ holdings, quotes, calls }) }
  );
  const body = await responseJson(response);
  assert.equal(response.status, 503);
  assert.equal(body.code, 'MISSING_FMP_API_KEY');
  assert.equal(calls.length, 0);
}

async function testSuccessfulRefreshAndGet() {
  const bucket = new MockBucket();
  const calls = [];
  const env = { BUCKET: bucket, FMP_API_KEY: 'test-key' };
  const fetcher = makeFetcher({ holdings, quotes, calls });

  const post = await handleSp500Impact(request('POST'), env, { now: NOW, fetcher });
  const snapshot = await responseJson(post);

  assert.equal(post.status, 200);
  assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.rows[0].symbol, 'AAPL');
  assert.equal(snapshot.rows[0].impactPctPoints, 0.1065);
  assert.equal(snapshot.budget.callsUsed, 2);
  assert.equal(snapshot.budget.usedAfter, 2);
  assert.equal(calls.length, 2);

  const get = await handleSp500Impact(request('GET'), env);
  const cached = await responseJson(get);
  assert.equal(get.status, 200);
  assert.equal(cached.generatedAt, snapshot.generatedAt);
}

async function testHoldingsCacheHit() {
  const bucket = new MockBucket();
  const firstCalls = [];
  const env = { BUCKET: bucket, FMP_API_KEY: { get: async () => 'test-key' } };

  await handleSp500Impact(
    request('POST'),
    env,
    { now: NOW, fetcher: makeFetcher({ holdings, quotes, calls: firstCalls }) }
  );

  const secondCalls = [];
  const second = await handleSp500Impact(
    request('POST'),
    env,
    { now: new Date(NOW.getTime() + 10 * 60 * 1000), fetcher: makeFetcher({ holdings: [], quotes, calls: secondCalls }) }
  );
  const snapshot = await responseJson(second);

  assert.equal(second.status, 200);
  assert.equal(snapshot.cache.holdingsCacheHit, true);
  assert.equal(snapshot.budget.holdingsCalls, 0);
  assert.equal(snapshot.budget.quoteCalls, 1);
  assert.equal(secondCalls.length, 1);
  assert.equal(new URL(secondCalls[0].url).pathname.endsWith('/batch-quote'), true);
}

async function testBudgetExceeded() {
  const bucket = new MockBucket({
    'sp500-impact/usage/2026-05-27.json': JSON.stringify({
      date: '2026-05-27',
      used: 220
    })
  });
  const calls = [];
  const response = await handleSp500Impact(
    request('POST'),
    { BUCKET: bucket, FMP_API_KEY: 'test-key', FMP_DAILY_CALL_CAP: '220' },
    { now: NOW, fetcher: makeFetcher({ holdings, quotes, calls }) }
  );
  const body = await responseJson(response);
  assert.equal(response.status, 429);
  assert.equal(body.code, 'BUDGET_EXCEEDED');
  assert.equal(calls.length, 0);
}

async function testFmpError() {
  const response = await handleSp500Impact(
    request('POST'),
    { BUCKET: new MockBucket(), FMP_API_KEY: 'test-key' },
    { now: NOW, fetcher: makeFetcher({ holdings, quotes, failHoldings: true }) }
  );
  const body = await responseJson(response);
  assert.equal(response.status, 502);
  assert.equal(body.code, 'REFRESH_FAILED');
  assert.equal(body.upstreamStatus, 500);
}

const tests = [
  testNoCache,
  testMissingSecret,
  testSuccessfulRefreshAndGet,
  testHoldingsCacheHit,
  testBudgetExceeded,
  testFmpError
];

for (const test of tests) {
  await test();
  console.log(`ok ${test.name}`);
}
