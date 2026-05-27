import assert from 'node:assert/strict';
import { handleFmpDiagnostics, handleSp500Impact } from '../worker.js';

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

function diagnosticsRequest(method, query = '') {
  return new Request(`https://sandbox.test/api/sp500-impact/diagnostics${query}`, { method });
}

async function responseJson(response) {
  return response.json();
}

function makeFetcher({
  holdings,
  constituents = [],
  quotes,
  failHoldings = false,
  restrictHoldings = false,
  restrictConstituents = false,
  restrictBatchQuote = false,
  failQuotes = false,
  calls = []
}) {
  return async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {} });
    assert.equal(url.includes('test-key'), false, 'API key must not be placed in the URL');

    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/etf/holdings')) {
      if (restrictHoldings) {
        return new Response('Restricted Endpoint: This endpoint is not available under your current subscription', { status: 403 });
      }
      if (failHoldings) return new Response('holdings unavailable', { status: 500 });
      return Response.json(holdings);
    }

    if (parsed.pathname.endsWith('/sp500-constituent')) {
      if (restrictConstituents) {
        return new Response('Restricted Endpoint: This endpoint is not available under your current subscription', { status: 403 });
      }
      return Response.json(constituents);
    }

    if (parsed.pathname.endsWith('/batch-quote')) {
      if (restrictBatchQuote) {
        return new Response('Restricted Endpoint: This endpoint is not available under your current subscription', { status: 403 });
      }
      if (failQuotes) return new Response('quotes unavailable', { status: 503 });
      const symbols = new Set((parsed.searchParams.get('symbols') || '').split(','));
      return Response.json(quotes.filter((quote) => symbols.has(quote.symbol)));
    }

    if (parsed.pathname.endsWith('/quote')) {
      const symbol = parsed.searchParams.get('symbol');
      return Response.json(quotes.filter((quote) => quote.symbol === symbol));
    }

    if (parsed.pathname.endsWith('/batch-quote-short')) {
      const symbols = new Set((parsed.searchParams.get('symbols') || '').split(','));
      return Response.json(quotes
        .filter((quote) => symbols.has(quote.symbol))
        .map((quote) => ({
          symbol: quote.symbol,
          price: quote.price,
          change: quote.change,
          changesPercentage: quote.changesPercentage,
          volume: 1000
        })));
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
  { symbol: 'AAPL', name: 'Apple Inc.', price: 200, changesPercentage: 1.5, change: 3, marketCap: 3000 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', price: 420, changesPercentage: -1, change: -4.2, marketCap: 2500 },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', price: 110, changesPercentage: 2, change: 2.2, marketCap: 500 },
  { symbol: 'BAD', name: 'Malformed Quote', price: 12 }
];

const constituents = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy' }
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

async function testRestrictedHoldingsFallsBackToMarketCapWeights() {
  const bucket = new MockBucket();
  const calls = [];
  const response = await handleSp500Impact(
    request('POST'),
    { BUCKET: bucket, FMP_API_KEY: 'test-key' },
    { now: NOW, fetcher: makeFetcher({ holdings, constituents, quotes, restrictHoldings: true, calls }) }
  );
  const snapshot = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(snapshot.source.weightMode, 'marketCap');
  assert.equal(snapshot.source.weightProxy, 'S&P 500 market-cap estimate');
  assert.equal(snapshot.cache.holdingsCacheName, 'sp500-constituents');
  assert.equal(snapshot.budget.callsUsed, 3);
  assert.equal(snapshot.budget.universeCalls, 2);
  assert.equal(calls.length, 3);
  assert.equal(new URL(calls[0].url).pathname.endsWith('/etf/holdings'), true);
  assert.equal(new URL(calls[1].url).pathname.endsWith('/sp500-constituent'), true);
  assert.equal(new URL(calls[2].url).pathname.endsWith('/batch-quote'), true);

  const apple = snapshot.rows.find((row) => row.symbol === 'AAPL');
  assert.equal(apple.weightPct, 50);
  assert.equal(apple.impactPctPoints, 0.75);
}

async function testRestrictedIndexFallsBackToStaticUniverse() {
  const bucket = new MockBucket();
  const calls = [];
  const response = await handleSp500Impact(
    request('POST'),
    { BUCKET: bucket, FMP_API_KEY: 'test-key' },
    {
      now: NOW,
      fetcher: makeFetcher({
        holdings,
        constituents,
        quotes,
        restrictHoldings: true,
        restrictConstituents: true,
        calls
      })
    }
  );
  const snapshot = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(snapshot.source.weightMode, 'marketCap');
  assert.equal(snapshot.source.weightProxy, 'Static large-cap S&P watchlist');
  assert.equal(snapshot.cache.holdingsCacheName, 'static-large-cap-universe');
  assert.equal(snapshot.budget.callsUsed, 4);
  assert.equal(snapshot.budget.universeCalls, 2);
  assert.equal(calls.length, 4);
  assert.equal(new URL(calls[0].url).pathname.endsWith('/etf/holdings'), true);
  assert.equal(new URL(calls[1].url).pathname.endsWith('/sp500-constituent'), true);
  assert.equal(new URL(calls[2].url).pathname.endsWith('/batch-quote'), true);

  const cachedStatic = JSON.parse(bucket.objects.get('sp500-impact/sp500-constituents.json'));
  assert.equal(cachedStatic.cacheName, 'static-large-cap-universe');
}

async function testDiagnosticsRequiresRunFlag() {
  const response = await handleFmpDiagnostics(
    diagnosticsRequest('POST'),
    { BUCKET: new MockBucket(), FMP_API_KEY: 'test-key' },
    { now: NOW, fetcher: makeFetcher({ holdings, constituents, quotes }) }
  );
  const body = await responseJson(response);
  assert.equal(response.status, 400);
  assert.equal(body.code, 'RUN_CONFIRMATION_REQUIRED');
}

async function testDiagnosticsReportAndCache() {
  const bucket = new MockBucket();
  const calls = [];
  const env = { BUCKET: bucket, FMP_API_KEY: 'test-key' };
  const fetcher = makeFetcher({
    holdings,
    constituents,
    quotes,
    restrictHoldings: true,
    restrictConstituents: true,
    calls
  });

  const response = await handleFmpDiagnostics(
    diagnosticsRequest('POST', '?run=1'),
    env,
    { now: NOW, fetcher }
  );
  const report = await responseJson(response);

  assert.equal(response.status, 200);
  assert.equal(report.tests.length, 5);
  assert.deepEqual(report.summary.restricted, ['sp500Constituent', 'spyHoldings']);
  assert.equal(report.budget.callsUsed, 5);
  assert.equal(calls.length, 5);

  const cached = await handleFmpDiagnostics(
    diagnosticsRequest('GET'),
    env,
    { now: NOW, fetcher }
  );
  const cachedReport = await responseJson(cached);
  assert.equal(cached.status, 200);
  assert.equal(cachedReport.cacheHit, true);
  assert.equal(calls.length, 5);
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
  testRestrictedHoldingsFallsBackToMarketCapWeights,
  testRestrictedIndexFallsBackToStaticUniverse,
  testDiagnosticsRequiresRunFlag,
  testDiagnosticsReportAndCache,
  testFmpError
];

for (const test of tests) {
  await test();
  console.log(`ok ${test.name}`);
}
