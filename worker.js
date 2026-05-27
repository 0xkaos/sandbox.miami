const SP500_SNAPSHOT_KEY = 'sp500-impact/latest.json';
const SP500_HOLDINGS_KEY = 'sp500-impact/spy-holdings.json';
const SP500_CONSTITUENTS_KEY = 'sp500-impact/sp500-constituents.json';
const SP500_USAGE_PREFIX = 'sp500-impact/usage/';
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const SP500_WEIGHT_SYMBOL = 'SPY';
const SP500_DEFAULT_DAILY_CALL_CAP = 220;
const SP500_HOLDINGS_TTL_MS = 24 * 60 * 60 * 1000;
const SP500_CONSTITUENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SP500_QUOTE_CHUNK_SIZE = 90;

function apiJson(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

async function readR2Json(bucket, key) {
  const object = await bucket.get(key);
  if (object === null) return null;

  const text = await new Response(object.body).text();
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function writeR2Json(bucket, key, payload) {
  await bucket.put(key, JSON.stringify(payload, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });
}

function todayKey(now) {
  return now.toISOString().slice(0, 10);
}

function usageKey(date) {
  return `${SP500_USAGE_PREFIX}${date}.json`;
}

async function loadUsage(bucket, now) {
  const date = todayKey(now);
  const stored = await readR2Json(bucket, usageKey(date)).catch(() => null);
  return {
    date,
    used: Number.isFinite(Number(stored?.used)) ? Number(stored.used) : 0,
    refreshedAt: stored?.refreshedAt || null
  };
}

async function saveUsage(bucket, usage) {
  await writeR2Json(bucket, usageKey(usage.date), {
    date: usage.date,
    used: usage.used,
    refreshedAt: usage.refreshedAt
  });
}

function parseDailyCap(env) {
  const parsed = Number(env.FMP_DAILY_CALL_CAP);
  if (!Number.isFinite(parsed) || parsed <= 0) return SP500_DEFAULT_DAILY_CALL_CAP;
  return Math.min(Math.floor(parsed), 250);
}

function budgetStatus(usage, limit, plannedCalls = 0) {
  const remaining = Math.max(0, limit - usage.used);
  return {
    date: usage.date,
    limit,
    used: usage.used,
    remaining,
    plannedCalls,
    canSpend: usage.used + plannedCalls <= limit
  };
}

function cleanSymbol(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;
  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHoldings(rawRows) {
  if (!Array.isArray(rawRows)) return [];

  const bySymbol = new Map();
  for (const row of rawRows) {
    const symbol = cleanSymbol(row.symbol || row.asset || row.ticker || row.holdingSymbol);
    const weightPct = parseNumber(
      row.weightPercentage ?? row.weightPercent ?? row.percentage ?? row.weight
    );

    if (!symbol || symbol.includes('CASH') || symbol.includes('USD') || weightPct === null || weightPct <= 0) {
      continue;
    }

    const existing = bySymbol.get(symbol);
    const normalized = {
      symbol,
      name: row.name || row.assetName || row.companyName || symbol,
      sector: row.sector || row.industry || 'Unclassified',
      weightPct,
      shares: parseNumber(row.sharesNumber ?? row.shares ?? row.shareNumber),
      marketValue: parseNumber(row.marketValue ?? row.market_value),
      isin: row.isin || null,
      cusip: row.cusip || null
    };

    if (existing) {
      existing.weightPct += normalized.weightPct;
      existing.marketValue = existing.marketValue || normalized.marketValue;
      existing.shares = existing.shares || normalized.shares;
    } else {
      bySymbol.set(symbol, normalized);
    }
  }

  const holdings = Array.from(bySymbol.values());
  const totalWeight = holdings.reduce((sum, row) => sum + row.weightPct, 0);
  const maxWeight = holdings.reduce((max, row) => Math.max(max, row.weightPct), 0);

  if (totalWeight > 0 && totalWeight <= 2 && maxWeight <= 1) {
    for (const row of holdings) {
      row.weightPct *= 100;
    }
  }

  return holdings.sort((a, b) => b.weightPct - a.weightPct);
}

function normalizeConstituents(rawRows) {
  if (!Array.isArray(rawRows)) return [];

  const bySymbol = new Map();
  for (const row of rawRows) {
    const symbol = cleanSymbol(row.symbol || row.ticker);
    if (!symbol) continue;

    bySymbol.set(symbol, {
      symbol,
      name: row.name || row.companyName || symbol,
      sector: row.sector || row.gicsSector || 'Unclassified',
      subSector: row.subSector || row.gicsSubIndustry || null,
      weightPct: null
    });
  }

  return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function normalizeQuotes(rawRows) {
  const quotes = new Map();
  if (!Array.isArray(rawRows)) return quotes;

  for (const row of rawRows) {
    const symbol = cleanSymbol(row.symbol || row.ticker);
    const changePct = parseNumber(
      row.changesPercentage ?? row.changePercentage ?? row.changePercent ?? row.percentChange
    );
    const price = parseNumber(row.price ?? row.close ?? row.previousClose);

    if (!symbol || changePct === null || price === null) continue;

    quotes.set(symbol, {
      symbol,
      name: row.name || row.companyName || null,
      price,
      change: parseNumber(row.change ?? row.changes),
      changePct,
      volume: parseNumber(row.volume),
      dayLow: parseNumber(row.dayLow),
      dayHigh: parseNumber(row.dayHigh),
      yearLow: parseNumber(row.yearLow),
      yearHigh: parseNumber(row.yearHigh),
      marketCap: parseNumber(row.marketCap),
      exchange: row.exchange || row.exchangeShortName || null,
      timestamp: row.timestamp || null
    });
  }

  return quotes;
}

function chunkSymbols(symbols) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += SP500_QUOTE_CHUNK_SIZE) {
    chunks.push(symbols.slice(i, i + SP500_QUOTE_CHUNK_SIZE));
  }
  return chunks;
}

function buildFmpUrl(pathname, params = {}) {
  const url = new URL(`${FMP_BASE_URL}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function getFmpApiKey(env) {
  const candidate = env.FMP_API_KEY || env.FMP_API_KEY_SECRET;

  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }

  if (candidate && typeof candidate.get === 'function') {
    const value = await candidate.get();
    return typeof value === 'string' ? value.trim() : '';
  }

  return '';
}

async function fetchFmpJson(pathname, params, apiKey, fetcher) {
  const url = buildFmpUrl(pathname, params);
  const response = await fetcher(url.toString(), {
    headers: {
      Accept: 'application/json',
      apikey: apiKey
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const message = detail ? detail.slice(0, 280) : `HTTP ${response.status}`;
    const error = new Error(`FMP request failed: ${message}`);
    error.status = 502;
    error.upstreamStatus = response.status;
    throw error;
  }

  return response.json();
}

function isRestrictedFmpError(err) {
  return err?.upstreamStatus === 402
    || err?.upstreamStatus === 403
    || /restricted endpoint|current subscription|upgrade your plan/i.test(err?.message || '');
}

async function spendCall(bucket, usage, now) {
  usage.used += 1;
  usage.refreshedAt = now.toISOString();
  await saveUsage(bucket, usage);
}

function createImpactSnapshot(holdings, quoteRows, context) {
  const quotes = normalizeQuotes(quoteRows);
  const rows = [];
  const missingQuotes = [];
  const missingWeights = [];
  const weightMode = context.weightMode || 'explicit';
  const totalMarketCap = weightMode === 'marketCap'
    ? holdings.reduce((sum, holding) => {
        const quote = quotes.get(holding.symbol);
        return sum + Math.max(0, Number(quote?.marketCap) || 0);
      }, 0)
    : 0;

  for (const holding of holdings) {
    const quote = quotes.get(holding.symbol);
    if (!quote) {
      missingQuotes.push(holding.symbol);
      continue;
    }

    let weightPct = holding.weightPct;
    if (weightMode === 'marketCap') {
      const marketCap = Number(quote.marketCap);
      if (!Number.isFinite(marketCap) || marketCap <= 0 || totalMarketCap <= 0) {
        missingWeights.push(holding.symbol);
        continue;
      }
      weightPct = marketCap / totalMarketCap * 100;
    }

    if (!Number.isFinite(Number(weightPct)) || Number(weightPct) <= 0) {
      missingWeights.push(holding.symbol);
      continue;
    }

    const impactPctPoints = weightPct * quote.changePct / 100;
    rows.push({
      rank: 0,
      symbol: holding.symbol,
      name: quote.name || holding.name,
      sector: holding.sector,
      weightPct: Number(weightPct.toFixed(4)),
      price: quote.price,
      change: quote.change,
      changePct: quote.changePct,
      impactPctPoints: Number(impactPctPoints.toFixed(5)),
      absImpactPctPoints: Number(Math.abs(impactPctPoints).toFixed(5)),
      volume: quote.volume,
      dayLow: quote.dayLow,
      dayHigh: quote.dayHigh,
      yearLow: quote.yearLow,
      yearHigh: quote.yearHigh,
      marketCap: quote.marketCap,
      exchange: quote.exchange
    });
  }

  rows.sort((a, b) => b.absImpactPctPoints - a.absImpactPctPoints);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const proxyMovePct = rows.reduce((sum, row) => sum + row.impactPctPoints, 0);
  const positiveImpact = rows
    .filter((row) => row.impactPctPoints > 0)
    .reduce((sum, row) => sum + row.impactPctPoints, 0);
  const negativeImpact = rows
    .filter((row) => row.impactPctPoints < 0)
    .reduce((sum, row) => sum + row.impactPctPoints, 0);

  return {
    generatedAt: context.now.toISOString(),
    source: {
      weightProxy: context.sourceLabel || `${SP500_WEIGHT_SYMBOL} ETF holdings`,
      weightMode,
      quoteSource: 'FMP batch-quote',
      note: context.sourceNote || 'SPY holdings are used as a practical proxy for S&P 500 index weights.',
      fallbackReason: context.fallbackReason || null
    },
    cache: {
      holdingsCacheHit: context.holdingsCacheHit,
      holdingsGeneratedAt: context.holdingsGeneratedAt,
      holdingsCacheName: context.holdingsCacheName || 'spy-holdings',
      holdingsAgeMinutes: context.holdingsGeneratedAt
        ? Math.round((context.now.getTime() - new Date(context.holdingsGeneratedAt).getTime()) / 60000)
        : null
    },
    budget: context.budget,
    stats: {
      holdingsCount: holdings.length,
      quotedCount: rows.length,
      missingQuoteCount: missingQuotes.length,
      missingQuotes: missingQuotes.slice(0, 24),
      missingWeightCount: missingWeights.length,
      missingWeights: missingWeights.slice(0, 24),
      proxyMovePct: Number(proxyMovePct.toFixed(5)),
      positiveImpactPctPoints: Number(positiveImpact.toFixed(5)),
      negativeImpactPctPoints: Number(negativeImpact.toFixed(5))
    },
    rows
  };
}

async function loadStoredHoldings(bucket) {
  const stored = await readR2Json(bucket, SP500_HOLDINGS_KEY).catch(() => null);
  if (!stored || !Array.isArray(stored.rows)) return null;
  return stored;
}

async function loadStoredConstituents(bucket) {
  const stored = await readR2Json(bucket, SP500_CONSTITUENTS_KEY).catch(() => null);
  if (!stored || !Array.isArray(stored.rows)) return null;
  return stored;
}

function createBudgetError(usage, limit, plannedCalls) {
  const status = budgetStatus(usage, limit, plannedCalls);
  const error = new Error('Daily FMP call safety cap would be exceeded.');
  error.code = 'BUDGET_EXCEEDED';
  error.status = 429;
  error.budget = status;
  return error;
}

async function getConstituents(bucket, usage, limit, apiKey, fetcher, now, estimatedQuoteCalls) {
  const stored = await loadStoredConstituents(bucket);
  const storedAt = stored?.generatedAt ? new Date(stored.generatedAt) : null;
  const storedFresh = storedAt && Number.isFinite(storedAt.getTime())
    && now.getTime() - storedAt.getTime() < SP500_CONSTITUENTS_TTL_MS;

  if (storedFresh) {
    return {
      rows: stored.rows,
      generatedAt: stored.generatedAt,
      cacheHit: true,
      cacheName: 'sp500-constituents',
      callsUsed: 0,
      sourceLabel: 'S&P 500 market-cap estimate',
      sourceNote: 'SPY holdings were unavailable for this FMP subscription, so S&P 500 constituents are weighted by quote market cap as a practical estimate.',
      weightMode: 'marketCap'
    };
  }

  if (!budgetStatus(usage, limit, 2 + estimatedQuoteCalls).canSpend) {
    throw createBudgetError(usage, limit, 2 + estimatedQuoteCalls);
  }

  const rawConstituents = await fetchFmpJson('/sp500-constituent', {}, apiKey, fetcher);
  await spendCall(bucket, usage, now);

  const rows = normalizeConstituents(rawConstituents);
  if (!rows.length) {
    const error = new Error('FMP returned no usable S&P 500 constituents.');
    error.code = 'EMPTY_CONSTITUENTS';
    error.status = 502;
    throw error;
  }

  const payload = {
    generatedAt: now.toISOString(),
    source: 'S&P 500 constituents',
    rows
  };
  await writeR2Json(bucket, SP500_CONSTITUENTS_KEY, payload);

  return {
    rows,
    generatedAt: payload.generatedAt,
    cacheHit: false,
    cacheName: 'sp500-constituents',
    callsUsed: 1,
    sourceLabel: 'S&P 500 market-cap estimate',
    sourceNote: 'SPY holdings were unavailable for this FMP subscription, so S&P 500 constituents are weighted by quote market cap as a practical estimate.',
    weightMode: 'marketCap'
  };
}

async function getHoldings(bucket, usage, limit, apiKey, fetcher, now) {
  const stored = await loadStoredHoldings(bucket);
  const storedAt = stored?.generatedAt ? new Date(stored.generatedAt) : null;
  const storedFresh = storedAt && Number.isFinite(storedAt.getTime())
    && now.getTime() - storedAt.getTime() < SP500_HOLDINGS_TTL_MS;

  if (storedFresh) {
    return {
      rows: stored.rows,
      generatedAt: stored.generatedAt,
      cacheHit: true,
      cacheName: 'spy-holdings',
      callsUsed: 0,
      sourceLabel: `${SP500_WEIGHT_SYMBOL} ETF holdings`,
      sourceNote: 'SPY holdings are used as a practical proxy for S&P 500 index weights.',
      weightMode: 'explicit'
    };
  }

  const estimatedSymbols = stored?.rows?.length || 505;
  const estimatedQuoteCalls = chunkSymbols(new Array(estimatedSymbols).fill('SPY')).length;
  if (!budgetStatus(usage, limit, 1 + estimatedQuoteCalls).canSpend) {
    throw createBudgetError(usage, limit, 1 + estimatedQuoteCalls);
  }

  try {
    const rawHoldings = await fetchFmpJson('/etf/holdings', { symbol: SP500_WEIGHT_SYMBOL }, apiKey, fetcher);
    await spendCall(bucket, usage, now);

    const rows = normalizeHoldings(rawHoldings);
    if (!rows.length) {
      const error = new Error('FMP returned no usable SPY holdings.');
      error.code = 'EMPTY_HOLDINGS';
      error.status = 502;
      throw error;
    }

    const payload = {
      generatedAt: now.toISOString(),
      source: `${SP500_WEIGHT_SYMBOL} ETF holdings`,
      rows
    };
    await writeR2Json(bucket, SP500_HOLDINGS_KEY, payload);

    return {
      rows,
      generatedAt: payload.generatedAt,
      cacheHit: false,
      cacheName: 'spy-holdings',
      callsUsed: 1,
      sourceLabel: `${SP500_WEIGHT_SYMBOL} ETF holdings`,
      sourceNote: 'SPY holdings are used as a practical proxy for S&P 500 index weights.',
      weightMode: 'explicit'
    };
  } catch (err) {
    if (!isRestrictedFmpError(err) && err?.code !== 'EMPTY_HOLDINGS') {
      throw err;
    }

    if (isRestrictedFmpError(err)) {
      await spendCall(bucket, usage, now);
    }
    const fallback = await getConstituents(bucket, usage, limit, apiKey, fetcher, now, estimatedQuoteCalls);
    return {
      ...fallback,
      callsUsed: fallback.callsUsed + 1,
      fallbackReason: 'FMP rejected the SPY ETF holdings endpoint for this subscription.'
    };
  }
}

async function refreshSp500Impact(bucket, env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || new Date();
  const apiKey = await getFmpApiKey(env);

  if (!apiKey) {
    return apiJson({
      error: 'FMP_API_KEY is not configured.',
      code: 'MISSING_FMP_API_KEY'
    }, 503);
  }

  const limit = parseDailyCap(env);
  const usage = await loadUsage(bucket, now);
  const usedBefore = usage.used;

  const holdings = await getHoldings(bucket, usage, limit, apiKey, fetcher, now);
  const symbols = holdings.rows.map((row) => row.symbol);
  const chunks = chunkSymbols(symbols);
  const quoteCalls = chunks.length;

  if (!budgetStatus(usage, limit, quoteCalls).canSpend) {
    return apiJson({
      error: 'Daily FMP call safety cap would be exceeded.',
      code: 'BUDGET_EXCEEDED',
      budget: budgetStatus(usage, limit, quoteCalls)
    }, 429);
  }

  const quoteRows = [];
  for (const chunk of chunks) {
    const data = await fetchFmpJson('/batch-quote', { symbols: chunk.join(',') }, apiKey, fetcher);
    await spendCall(bucket, usage, now);
    if (Array.isArray(data)) {
      quoteRows.push(...data);
    }
  }

  const callsUsed = usage.used - usedBefore;
  const snapshot = createImpactSnapshot(holdings.rows, quoteRows, {
    now,
    holdingsCacheHit: holdings.cacheHit,
    holdingsGeneratedAt: holdings.generatedAt,
    holdingsCacheName: holdings.cacheName,
    sourceLabel: holdings.sourceLabel,
    sourceNote: holdings.sourceNote,
    weightMode: holdings.weightMode,
    fallbackReason: holdings.fallbackReason,
    budget: {
      date: usage.date,
      limit,
      usedBefore,
      usedAfter: usage.used,
      remaining: Math.max(0, limit - usage.used),
      callsUsed,
      holdingsCalls: holdings.callsUsed,
      universeCalls: holdings.callsUsed,
      quoteCalls
    }
  });

  await writeR2Json(bucket, SP500_SNAPSHOT_KEY, snapshot);
  return apiJson(snapshot);
}

export async function handleSp500Impact(request, env, options = {}) {
  if (!env.BUCKET) {
    return apiJson({
      error: "R2 Bucket 'BUCKET' not bound.",
      code: 'MISSING_BUCKET'
    }, 503);
  }

  if (request.method === 'GET') {
    const snapshot = await readR2Json(env.BUCKET, SP500_SNAPSHOT_KEY).catch((err) => ({
      error: 'Failed to read cached S&P impact snapshot.',
      detail: err.message
    }));

    if (!snapshot) {
      return apiJson({
        error: 'No cached S&P impact snapshot yet. Click Refresh to create one.',
        code: 'NO_CACHE'
      }, 404);
    }

    if (snapshot.error) {
      return apiJson(snapshot, 500);
    }

    return apiJson(snapshot);
  }

  if (request.method === 'POST') {
    try {
      return await refreshSp500Impact(env.BUCKET, env, options);
    } catch (err) {
      const status = err.status || 502;
      return apiJson({
        error: err.message || 'S&P impact refresh failed.',
        code: err.code || 'REFRESH_FAILED',
        upstreamStatus: err.upstreamStatus || undefined,
        budget: err.budget || undefined
      }, status);
    }
  }

  return apiJson({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
}

export class StylusSession {
  constructor(state) {
    this.state = state;
    this.clients = new Map();
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role');

    if (role !== 'desktop' && role !== 'mobile') {
      return new Response('Missing or invalid role', { status: 400 });
    }

    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);

    serverSocket.accept();
    this.clients.set(role, serverSocket);

    const sendPresence = () => {
      const desktopConnected = this.clients.has('desktop');
      const mobileConnected = this.clients.has('mobile');
      const payload = JSON.stringify({
        type: 'presence',
        desktopConnected,
        mobileConnected
      });

      for (const ws of this.clients.values()) {
        try {
          ws.send(payload);
        } catch (_) {
          // Ignore stale sockets; close handler will clean up.
        }
      }
    };

    sendPresence();

    serverSocket.addEventListener('message', (event) => {
      if (role === 'mobile') {
        const desktopSocket = this.clients.get('desktop');
        if (desktopSocket) {
          try {
            desktopSocket.send(event.data);
          } catch (_) {
            // Ignore failed sends to stale desktop socket.
          }
        }
      }
    });

    serverSocket.addEventListener('close', () => {
      this.clients.delete(role);
      sendPresence();
    });

    serverSocket.addEventListener('error', () => {
      this.clients.delete(role);
      sendPresence();
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API Endpoint: /api/sp500-impact
    if (url.pathname === '/api/sp500-impact') {
      return handleSp500Impact(request, env);
    }

    // WebSocket Endpoint: /api/stylus/socket
    if (url.pathname === '/api/stylus/socket') {
      const sessionId = url.searchParams.get('session');

      if (!sessionId) {
        return new Response(JSON.stringify({ error: 'Missing session query param.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (!env.STYLUS_SESSIONS) {
        return new Response(JSON.stringify({ error: "Durable Object binding 'STYLUS_SESSIONS' is missing." }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const id = env.STYLUS_SESSIONS.idFromName(sessionId);
      const stub = env.STYLUS_SESSIONS.get(id);
      return stub.fetch(request);
    }

    // API Endpoint: /api/letters
    if (url.pathname === '/api/letters') {
      // 1. Check if R2 is bound
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: "R2 Bucket 'BUCKET' is not bound in Cloudflare Settings." }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 2. Handle GET (Read)
      if (request.method === 'GET') {
        try {
          const object = await env.BUCKET.get('letters.json');
          
          if (object === null) {
            return new Response("Not found", { status: 404 });
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Content-Type', 'application/json');

          return new Response(object.body, { headers });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), { status: 500 });
        }
      }

      // 3. Handle POST (Write)
      if (request.method === 'POST') {
        try {
          const data = await request.json();
          let contentToSave = data;

          // Support Partial Updates: { char: "Aleph", strokes: [...] }
          if (data.char && data.strokes) {
            const existing = await env.BUCKET.get('letters.json');
            let store = {};
            if (existing) {
              store = await existing.json();
            }
            store[data.char] = data.strokes;
            contentToSave = store;
          }

          // Write to R2
          await env.BUCKET.put('letters.json', JSON.stringify(contentToSave, null, 2), {
            httpMetadata: { contentType: 'application/json' }
          });

          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Save failed: " + err.message }), { status: 500 });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // API Endpoint: /api/audio
    if (url.pathname === '/api/audio') {
      if (!env.BUCKET) {
        return new Response(JSON.stringify({ error: "R2 Bucket 'BUCKET' not bound." }), { 
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
      }

      // GET
      if (request.method === 'GET') {
        try {
          const object = await env.BUCKET.get('audio.json');
          
          if (object === null) {
            return new Response(JSON.stringify({}, null, 2), {
                headers: { 'Content-Type': 'application/json' }
            });
          }

          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set('etag', object.httpEtag);
          headers.set('Content-Type', 'application/json');

          return new Response(object.body, { headers });
        } catch (err) {
          return new Response(JSON.stringify({ error: "Error reading from R2", detail: err.message }), { 
              status: 500,
              headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // POST
      if (request.method === 'POST') {
        try {
            // Password Protection
            const password = request.headers.get('x-admin-password');
            const correctPassword = env.ADMIN_PASSWORD || "admin";
            
            if (password !== correctPassword) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            let body;
            try {
                body = await request.json();
            } catch (e) {
                return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }

            // Partial Update
            if (body && typeof body === 'object' && body.pattern && body.data) {
                const existing = await env.BUCKET.get('audio.json');
                let store = {};
                if (existing !== null) {
                    const txt = await new Response(existing.body).text();
                    try { store = JSON.parse(txt); } catch (e) { store = {}; }
                }

                store[body.pattern] = body.data;

                const json = JSON.stringify(store, null, 2);
                await env.BUCKET.put('audio.json', json, {
                    httpMetadata: { contentType: 'application/json' }
                });

                return new Response(JSON.stringify({ ok: true, updated: body.pattern }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            // Full Replacement
            if (body && typeof body === 'object') {
                const json = JSON.stringify(body, null, 2);
                await env.BUCKET.put('audio.json', json, {
                    httpMetadata: { contentType: 'application/json' }
                });

                return new Response(JSON.stringify({ ok: true, replaced: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ error: 'Invalid JSON payload structure' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

        } catch (err) {
            return new Response(JSON.stringify({ error: 'Error saving to R2', detail: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      return new Response("Method not allowed", { status: 405 });
    }

    // 4. Serve Static Assets (default behavior)
    return env.ASSETS.fetch(request);
  }
};
