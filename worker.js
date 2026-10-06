import { handleAcousticStates } from './lib/acoustic-states.mjs';
import { argon2id } from '@noble/hashes/argon2.js';

const SP500_SNAPSHOT_KEY = 'sp500-impact/latest.json';
const SP500_HOLDINGS_KEY = 'sp500-impact/spy-holdings.json';
const SP500_CONSTITUENTS_KEY = 'sp500-impact/sp500-constituents.json';
const SP500_DIAGNOSTICS_KEY = 'sp500-impact/fmp-diagnostics.json';
const SP500_USAGE_PREFIX = 'sp500-impact/usage/';
const ROAD_R2_PREFIX = 'human-atlas/road/v1/';
const ROAD_PARTITIONS = new Set(['central-asia', 'europe', 'north-africa', 'other', 'west-asia']);
const EDITOR_NOTES_R2_PREFIX = 'human-atlas/editor-notes/v1/';
const NOTES_SESSION_COOKIE = 'ha_notes_session';
const NOTES_SESSION_SECONDS = 60 * 60 * 24 * 7;
const NOTES_PASSWORD_OPTIONS = { m: 19_456, t: 2, p: 1, dkLen: 32 };
const NOTES_MAX_BODY_BYTES = 300_000;
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';
const SP500_WEIGHT_SYMBOL = 'SPY';
const SP500_DEFAULT_DAILY_CALL_CAP = 220;
const SP500_HOLDINGS_TTL_MS = 24 * 60 * 60 * 1000;
const SP500_CONSTITUENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SP500_DIAGNOSTICS_TTL_MS = 60 * 60 * 1000;
const SP500_QUOTE_CHUNK_SIZE = 90;

const SP500_STATIC_SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'BRK-B', 'AVGO', 'LLY',
  'TSLA', 'JPM', 'V', 'UNH', 'XOM', 'MA', 'COST', 'WMT', 'PG', 'NFLX',
  'JNJ', 'HD', 'ABBV', 'BAC', 'KO', 'PM', 'CRM', 'ORCL', 'CVX', 'AMD',
  'WFC', 'CSCO', 'ABT', 'IBM', 'MCD', 'LIN', 'GE', 'MRK', 'DIS', 'AXP',
  'T', 'NOW', 'ISRG', 'QCOM', 'INTU', 'GS', 'VZ', 'UBER', 'RTX', 'BX',
  'PEP', 'BKNG', 'AMGN', 'CAT', 'MS', 'PGR', 'SPGI', 'TMO', 'NEE', 'SCHW',
  'BLK', 'TXN', 'HON', 'DHR', 'BA', 'SYK', 'UNP', 'TJX', 'AMAT', 'LOW',
  'PFE', 'GILD', 'ADBE', 'DE', 'C', 'VRTX', 'CMCSA', 'PANW', 'ADI', 'COP',
  'MDT', 'MMC', 'LMT', 'CB', 'PLD', 'SBUX', 'BMY', 'MO', 'SO', 'ADP',
  'ELV', 'KLAC', 'ETN', 'NKE', 'ANET', 'UPS', 'INTC', 'FI', 'ICE', 'MU',
  'APH', 'MCO', 'WM', 'DUK', 'SHW', 'EQIX', 'WELL', 'TT', 'AON', 'CI',
  'HCA', 'GEV', 'PH', 'MDLZ', 'CDNS', 'USB', 'MMM', 'SNPS', 'REGN', 'AJG',
  'MAR', 'ORLY', 'APO', 'PNC', 'ZTS', 'TDG', 'CL', 'ECL', 'GD', 'MSI',
  'ITW', 'NOC', 'EMR', 'CTAS', 'COF', 'EOG', 'BDX', 'WMB', 'APD', 'RCL',
  'FDX', 'BK', 'CSX', 'HLT', 'ADSK', 'TGT', 'MNST', 'ROP', 'FCX', 'AFL',
  'TRV', 'NSC', 'CME', 'AZO', 'DLR', 'PSA', 'O', 'JCI', 'NXPI', 'KMI'
];

const FMP_DIAGNOSTIC_TESTS = [
  { id: 'quote', label: 'Single stock quote', pathname: '/quote', params: { symbol: 'AAPL' } },
  { id: 'batchQuote', label: 'Batch stock quote', pathname: '/batch-quote', params: { symbols: 'AAPL,MSFT' } },
  { id: 'batchQuoteShort', label: 'Batch stock quote short', pathname: '/batch-quote-short', params: { symbols: 'AAPL,MSFT' } },
  { id: 'sp500Constituent', label: 'S&P 500 constituents', pathname: '/sp500-constituent', params: {} },
  { id: 'spyHoldings', label: 'SPY ETF holdings', pathname: '/etf/holdings', params: { symbol: SP500_WEIGHT_SYMBOL } }
];

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

const notesTextEncoder = new TextEncoder();
const notesBytes = length => crypto.getRandomValues(new Uint8Array(length));
const notesBase64 = bytes => btoa(String.fromCharCode(...bytes));
const notesId = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
const notesNow = () => new Date().toISOString();
const notesCookie = (value, maxAge = null) => `${NOTES_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict${maxAge == null ? '' : `; Max-Age=${maxAge}`}`;

function notesOriginAllowed(request) {
  return request.headers.get('origin') === new URL(request.url).origin;
}
function notesCookieValue(request) {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${NOTES_SESSION_COOKIE}=`))?.slice(NOTES_SESSION_COOKIE.length + 1) ?? null;
}
async function notesSha256(value) {
  const bytes = await crypto.subtle.digest('SHA-256', notesTextEncoder.encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function notesPasswordHash(password) {
  const salt = notesBytes(16), hash = argon2id(notesTextEncoder.encode(password), salt, NOTES_PASSWORD_OPTIONS);
  return `argon2id$v=1$m=${NOTES_PASSWORD_OPTIONS.m},t=${NOTES_PASSWORD_OPTIONS.t},p=${NOTES_PASSWORD_OPTIONS.p}$${notesBase64(salt)}$${notesBase64(hash)}`;
}
async function notesPasswordMatches(password, stored) {
  const match = typeof stored === 'string' && stored.match(/^argon2id\$v=1\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/);
  if (!match) return false;
  const [, m, t, p, saltText, hashText] = match;
  const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  const actual = argon2id(notesTextEncoder.encode(password), decode(saltText), { m: Number(m), t: Number(t), p: Number(p), dkLen: 32 });
  const expected = decode(hashText);
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
async function notesJson(request) {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > NOTES_MAX_BODY_BYTES) throw new Error('Request is too large.');
  const body = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
  return body;
}
async function notesSession(request, env) {
  const token = notesCookieValue(request);
  if (!token || !token.includes('.')) return null;
  const [id, secret] = token.split('.', 2);
  if (!/^[a-z0-9_]{10,80}$/.test(id) || !secret) return null;
  const secretHash = await notesSha256(secret);
  const now = notesNow();
  const row = await env.NOTES_DB.prepare(`SELECT s.id AS session_id, u.id, u.username, u.role, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.secret_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`)
    .bind(id, secretHash, now).first();
  return row?.status === 'active' ? row : null;
}
function notesRequireActive(session) {
  if (!session) return apiJson({ error: 'Sign in with an approved editor account.', code: 'AUTH_REQUIRED' }, 401);
  return null;
}
function notesRequireAdmin(session) {
  const denied = notesRequireActive(session);
  if (denied) return denied;
  return session.role === 'admin' ? null : apiJson({ error: 'Administrator approval required.', code: 'ADMIN_REQUIRED' }, 403);
}
async function notesThrottle(env, key, limit, windowSeconds) {
  const now = Date.now(), windowStart = new Date(now - windowSeconds * 1000).toISOString(), timestamp = new Date(now).toISOString();
  const existing = await env.NOTES_DB.prepare('SELECT count FROM auth_rate_limits WHERE key = ? AND window_start > ?').bind(key, windowStart).first();
  if (Number(existing?.count) >= limit) return false;
  await env.NOTES_DB.prepare(`INSERT INTO auth_rate_limits (key, window_start, count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN auth_rate_limits.window_start > excluded.window_start THEN auth_rate_limits.count + 1 ELSE 1 END, window_start = CASE WHEN auth_rate_limits.window_start > excluded.window_start THEN auth_rate_limits.window_start ELSE excluded.window_start END, updated_at = excluded.updated_at`)
    .bind(key, windowStart, timestamp).run();
  return true;
}
function notesClientKey(request) {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}
function notesUserSummary(row) {
  return { id: row.id, username: row.username, role: row.role, status: row.status, createdAt: row.created_at, approvedAt: row.approved_at ?? null };
}
function notesBody(payload) {
  const delta = payload.delta;
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!delta || typeof delta !== 'object' || Array.isArray(delta) || !Array.isArray(delta.ops)) throw new Error('Invalid editor content.');
  if (!text || text.length > 50_000 || JSON.stringify(delta).length > 200_000) throw new Error('Note content must be between 1 and 50,000 characters.');
  return { delta, text };
}
function notesMetadata(payload) {
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const lat = Number(payload.lat), lon = Number(payload.lon), startYear = Number(payload.startYear), endYear = Number(payload.endYear);
  const visibility = payload.visibility;
  if (!title || title.length > 180 || ![lat, lon, startYear, endYear].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear || !['private', 'shared', 'public'].includes(visibility)) throw new Error('Invalid note metadata.');
  return { title, lat, lon, startYear, endYear, visibility };
}
async function notesAccessUserIds(env, names, ownerId) {
  if (!Array.isArray(names) || names.length > 50) throw new Error('Choose at most 50 collaborators.');
  const cleaned = [...new Set(names.map(value => typeof value === 'string' ? value.trim().toLowerCase() : '').filter(value => /^[a-z0-9][a-z0-9_-]{2,31}$/.test(value)))];
  if (!cleaned.length) return [];
  const placeholders = cleaned.map(() => '?').join(',');
  const { results = [] } = await env.NOTES_DB.prepare(`SELECT id, username FROM users WHERE status = 'active' AND username IN (${placeholders})`).bind(...cleaned).all();
  if (results.length !== cleaned.length) throw new Error('Every collaborator must be an approved editor account.');
  return results.filter(user => user.id !== ownerId).map(user => user.id);
}

async function handleRoadExplorer(request, env) {
  if (request.method !== 'GET') {
    return apiJson({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  }
  if (!env.BUCKET) {
    return apiJson({ error: "R2 Bucket 'BUCKET' not bound.", code: 'MISSING_BUCKET' }, 503);
  }
  const partition = new URL(request.url).searchParams.get('partition');
  if (partition !== null && !ROAD_PARTITIONS.has(partition)) {
    return apiJson({ error: 'Unknown ROAD partition.', code: 'UNKNOWN_PARTITION' }, 404);
  }
  const key = `${ROAD_R2_PREFIX}${partition ? `${partition}.json` : 'manifest.json'}`;
  try {
    const object = await env.BUCKET.get(key);
    if (!object) return apiJson({ error: 'ROAD explorer data has not been published.', code: 'NOT_PUBLISHED' }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.httpEtag);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(object.body, { headers });
  } catch {
    return apiJson({ error: 'ROAD explorer data could not be read.', code: 'R2_READ_FAILED' }, 503);
  }
}

function editorNoteSummary(row) {
  return {
    id: row.id,
    title: row.title,
    lat: row.lat,
    lon: row.lon,
    startYear: row.start_year,
    endYear: row.end_year,
    author: row.author,
    visibility: row.visibility,
    updatedAt: row.updated_at
  };
}

async function handleEditorNotes(request, env) {
  if (request.method !== 'GET') return apiJson({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
  if (!env.NOTES_DB || !env.BUCKET) return apiJson({ error: 'Editor notes are not configured.', code: 'NOT_CONFIGURED' }, 503);
  const url = new URL(request.url), id = url.searchParams.get('id'), session = await notesSession(request, env), scope = url.searchParams.get('scope') ?? 'accessible';
  if (!['accessible', 'mine', 'shared', 'public'].includes(scope)) return apiJson({ error: 'Unknown note scope.', code: 'UNKNOWN_SCOPE' }, 400);
  const published = `n.visibility = 'public' AND n.publication_status = 'published'`;
  const accessible = session ? `(n.publication_status = 'published' AND (n.visibility = 'public' OR n.owner_id = ? OR EXISTS (SELECT 1 FROM note_access access WHERE access.note_id = n.id AND access.user_id = ?)))` : `(${published})`;
  const fields = `n.id, n.title, n.lat, n.lon, n.start_year, n.end_year, n.visibility, n.updated_at, u.username AS author`;
  try {
    if (id !== null) {
      if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) return apiJson({ error: 'Invalid note id.', code: 'INVALID_NOTE_ID' }, 400);
      const row = await env.NOTES_DB.prepare(`SELECT ${fields}, n.current_revision, n.owner_id, CASE WHEN n.owner_id = ? OR ? = 'admin' OR EXISTS (SELECT 1 FROM note_access access WHERE access.note_id = n.id AND access.user_id = ? AND access.permission = 'edit') THEN 1 ELSE 0 END AS can_edit FROM notes n JOIN users u ON u.id = n.owner_id WHERE n.id = ? AND ${accessible}`)
        .bind(session?.id ?? '', session?.role ?? '', session?.id ?? '', id, ...(session ? [session.id, session.id] : [])).first();
      if (!row) return apiJson({ error: 'Published note not found.', code: 'NOTE_NOT_FOUND' }, 404);
      const revision = await env.NOTES_DB.prepare('SELECT body_key FROM note_revisions WHERE note_id = ? AND revision = (SELECT current_revision FROM notes WHERE id = ?)')
        .bind(id, id).first();
      if (!revision?.body_key || !revision.body_key.startsWith(`${EDITOR_NOTES_R2_PREFIX}${id}/`)) return apiJson({ error: 'Published note body not found.', code: 'NOTE_BODY_NOT_FOUND' }, 404);
      const object = await env.BUCKET.get(revision.body_key);
      if (!object) return apiJson({ error: 'Published note body not found.', code: 'NOTE_BODY_NOT_FOUND' }, 404);
      const body = await new Response(object.body).json();
      const text = typeof body?.text === 'string' ? body.text.slice(0, 50_000) : '';
      const collaborators = row.can_edit ? await env.NOTES_DB.prepare('SELECT u.username FROM note_access access JOIN users u ON u.id = access.user_id WHERE access.note_id = ? ORDER BY u.username').bind(id).all() : { results: [] };
      return apiJson({ note: { ...editorNoteSummary(row), revision: row.current_revision, canEdit: !!row.can_edit, canDelete: !!session && (row.owner_id === session.id || session.role === 'admin'), collaborators: collaborators.results.map(user => user.username) }, body: row.can_edit ? body : { text } }, 200, { 'Cache-Control': row.visibility === 'public' ? 'public, max-age=300' : 'no-store' });
    }
    const scopeFilter = !session || scope === 'accessible' ? '' : scope === 'public' ? " AND n.visibility = 'public'" : scope === 'mine' ? ' AND n.owner_id = ?' : " AND n.owner_id != ? AND EXISTS (SELECT 1 FROM note_access access WHERE access.note_id = n.id AND access.user_id = ?)";
    const params = session ? [session.id, session.id] : [];
    if (session && scope === 'mine') params.push(session.id);
    if (session && scope === 'shared') params.push(session.id, session.id);
    const { results = [] } = await env.NOTES_DB.prepare(`SELECT ${fields} FROM notes n JOIN users u ON u.id = n.owner_id WHERE ${accessible}${scopeFilter} ORDER BY n.updated_at DESC LIMIT 1000`).bind(...params).all();
    return apiJson({ notes: results.map(editorNoteSummary), user: session ? notesUserSummary(session) : null }, 200, { 'Cache-Control': session ? 'no-store' : 'public, max-age=300' });
  } catch {
    return apiJson({ error: 'Editor notes could not be read.', code: 'NOTES_READ_FAILED' }, 503);
  }
}

async function handleNotesAuth(request, env) {
  if (!env.NOTES_DB) return apiJson({ error: 'Editor accounts are not configured.', code: 'NOT_CONFIGURED' }, 503);
  const url = new URL(request.url), action = url.pathname.split('/').at(-1);
  if (action === 'session' && request.method === 'GET') {
    const session = await notesSession(request, env);
    return apiJson({ user: session ? notesUserSummary(session) : null });
  }
  if (action === 'logout' && request.method === 'POST') {
    if (!notesOriginAllowed(request)) return apiJson({ error: 'Sign out from this site.', code: 'BAD_ORIGIN' }, 403);
    const session = await notesSession(request, env);
    if (session) await env.NOTES_DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').bind(notesNow(), session.session_id).run();
    return apiJson({ ok: true }, 200, { 'Set-Cookie': notesCookie('', 0) });
  }
  if (!['register', 'login'].includes(action) || request.method !== 'POST') return apiJson({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
  if (!notesOriginAllowed(request)) return apiJson({ error: 'Use this site to manage editor accounts.', code: 'BAD_ORIGIN' }, 403);
  if (!(await notesThrottle(env, `auth:${action}:${notesClientKey(request)}`, action === 'login' ? 10 : 5, 900))) return apiJson({ error: 'Too many attempts. Try again later.', code: 'RATE_LIMITED' }, 429);
  try {
    const body = await notesJson(request), username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '', password = typeof body.password === 'string' ? body.password : '';
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username) || password.length < 12 || password.length > 256) return apiJson({ error: 'Use a 3–32 character username and a password of at least 12 characters.', code: 'INVALID_CREDENTIALS' }, 400);
    if (action === 'register') {
      const exists = await env.NOTES_DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
      if (exists) return apiJson({ error: 'That username is unavailable.', code: 'USERNAME_UNAVAILABLE' }, 409);
      const now = notesNow();
      await env.NOTES_DB.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').bind(notesId('usr'), username, await notesPasswordHash(password), now).run();
      return apiJson({ ok: true, status: 'pending', message: 'Account requested. An administrator must approve it before sign-in.' }, 201);
    }
    const user = await env.NOTES_DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    if (!user || !(await notesPasswordMatches(password, user.password_hash))) return apiJson({ error: 'Username or password is incorrect.', code: 'LOGIN_FAILED' }, 401);
    if (user.status !== 'active') return apiJson({ error: user.status === 'pending' ? 'This account is awaiting administrator approval.' : 'This account is disabled.', code: 'ACCOUNT_INACTIVE' }, 403);
    const sessionId = notesId('ses'), secret = notesBase64(notesBytes(32)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const now = new Date(), expires = new Date(now.getTime() + NOTES_SESSION_SECONDS * 1000).toISOString();
    await env.NOTES_DB.prepare('INSERT INTO sessions (id, user_id, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(sessionId, user.id, await notesSha256(secret), now.toISOString(), expires).run();
    return apiJson({ user: notesUserSummary(user) }, 200, { 'Set-Cookie': notesCookie(`${sessionId}.${secret}`, NOTES_SESSION_SECONDS) });
  } catch (error) { return apiJson({ error: error.message || 'Account request failed.', code: 'AUTH_FAILED' }, 400); }
}

async function handleNotesAdmin(request, env) {
  if (!env.NOTES_DB) return apiJson({ error: 'Editor accounts are not configured.', code: 'NOT_CONFIGURED' }, 503);
  if (request.method !== 'GET' && !notesOriginAllowed(request)) return apiJson({ error: 'Use this site to manage editor accounts.', code: 'BAD_ORIGIN' }, 403);
  const url = new URL(request.url), action = url.pathname.split('/').at(-1), session = await notesSession(request, env);
  if (action === 'bootstrap' && request.method === 'POST') {
    const token = request.headers.get('x-notes-bootstrap-token');
    if (!env.NOTES_BOOTSTRAP_ADMIN_TOKEN || token !== env.NOTES_BOOTSTRAP_ADMIN_TOKEN) return apiJson({ error: 'Bootstrap token not accepted.', code: 'BOOTSTRAP_DENIED' }, 403);
    const admins = await env.NOTES_DB.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").first();
    if (admins) return apiJson({ error: 'An administrator already exists.', code: 'BOOTSTRAP_COMPLETE' }, 409);
    try {
      const { username } = await notesJson(request), user = await env.NOTES_DB.prepare('SELECT id FROM users WHERE username = ?').bind(String(username ?? '').trim().toLowerCase()).first();
      if (!user) return apiJson({ error: 'Registered user not found.', code: 'USER_NOT_FOUND' }, 404);
      await env.NOTES_DB.prepare("UPDATE users SET role = 'admin', status = 'active', approved_at = ? WHERE id = ?").bind(notesNow(), user.id).run();
      return apiJson({ ok: true });
    } catch (error) { return apiJson({ error: error.message || 'Bootstrap failed.' }, 400); }
  }
  const denied = notesRequireAdmin(session); if (denied) return denied;
  if (action === 'users' && request.method === 'GET') {
    const { results = [] } = await env.NOTES_DB.prepare('SELECT id, username, role, status, created_at, approved_at FROM users ORDER BY status, created_at DESC LIMIT 200').all();
    return apiJson({ users: results.map(notesUserSummary) });
  }
  if (action === 'approve' && request.method === 'POST') {
    try {
      const { userId } = await notesJson(request), target = await env.NOTES_DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      if (!target) return apiJson({ error: 'User not found.', code: 'USER_NOT_FOUND' }, 404);
      await env.NOTES_DB.prepare("UPDATE users SET status = 'active', approved_at = ?, approved_by = ? WHERE id = ?").bind(notesNow(), session.id, userId).run();
      return apiJson({ ok: true });
    } catch (error) { return apiJson({ error: error.message || 'Approval failed.' }, 400); }
  }
  return apiJson({ error: 'Method not allowed.' }, 405);
}

async function notesCanEdit(env, noteId, user) {
  const row = await env.NOTES_DB.prepare(`SELECT n.*, CASE WHEN n.owner_id = ? OR ? = 'admin' OR EXISTS (SELECT 1 FROM note_access access WHERE access.note_id = n.id AND access.user_id = ? AND access.permission = 'edit') THEN 1 ELSE 0 END AS can_edit FROM notes n WHERE n.id = ?`)
    .bind(user.id, user.role, user.id, noteId).first();
  return row;
}
async function handleEditorNoteWrites(request, env) {
  if (!env.NOTES_DB || !env.BUCKET) return apiJson({ error: 'Editor notes are not configured.', code: 'NOT_CONFIGURED' }, 503);
  if (!notesOriginAllowed(request)) return apiJson({ error: 'Use this site to edit notes.', code: 'BAD_ORIGIN' }, 403);
  const session = await notesSession(request, env), denied = notesRequireActive(session); if (denied) return denied;
  const url = new URL(request.url), id = url.searchParams.get('id');
  try {
    if (request.method === 'POST') {
      const payload = await notesJson(request), metadata = notesMetadata(payload), body = notesBody(payload), collaborators = await notesAccessUserIds(env, payload.collaborators ?? [], session.id);
      const id = notesId('note'), now = notesNow(), bodyKey = `${EDITOR_NOTES_R2_PREFIX}${id}/1.json`, bodyText = JSON.stringify(body), hash = await notesSha256(bodyText);
      await env.BUCKET.put(bodyKey, bodyText, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
      const publication = 'published';
      const statements = [
        env.NOTES_DB.prepare('INSERT INTO notes (id, owner_id, title, lat, lon, start_year, end_year, visibility, publication_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, session.id, metadata.title, metadata.lat, metadata.lon, metadata.startYear, metadata.endYear, metadata.visibility, publication, now, now),
        env.NOTES_DB.prepare('INSERT INTO note_revisions (note_id, revision, author_id, body_key, body_sha256, created_at) VALUES (?, 1, ?, ?, ?, ?)').bind(id, session.id, bodyKey, hash, now),
        ...collaborators.map(userId => env.NOTES_DB.prepare("INSERT INTO note_access (note_id, user_id, permission, created_at) VALUES (?, ?, 'edit', ?)").bind(id, userId, now))
      ];
      await env.NOTES_DB.batch(statements);
      return apiJson({ note: { id, ...metadata, author: session.username, updatedAt: now, revision: 1 } }, 201);
    }
    if (!id || !/^note_[a-f0-9]{32}$/.test(id)) return apiJson({ error: 'Invalid note id.', code: 'INVALID_NOTE_ID' }, 400);
    const note = await notesCanEdit(env, id, session);
    if (!note) return apiJson({ error: 'Note not found.', code: 'NOTE_NOT_FOUND' }, 404);
    if (!note.can_edit) return apiJson({ error: 'You do not have edit access to this note.', code: 'NOTE_EDIT_DENIED' }, 403);
    if (request.method === 'DELETE') {
      if (note.owner_id !== session.id && session.role !== 'admin') return apiJson({ error: 'Only the owner or an administrator can delete this note.', code: 'NOTE_DELETE_DENIED' }, 403);
      await env.NOTES_DB.prepare("UPDATE notes SET publication_status = 'archived', updated_at = ? WHERE id = ?").bind(notesNow(), id).run();
      return apiJson({ ok: true });
    }
    if (request.method !== 'PUT') return apiJson({ error: 'Method not allowed.' }, 405, { Allow: 'POST, PUT, DELETE' });
    const payload = await notesJson(request), expected = Number(payload.revision);
    if (!Number.isInteger(expected) || expected !== note.current_revision) return apiJson({ error: 'This note changed elsewhere. Reload it before saving.', code: 'REVISION_CONFLICT', revision: note.current_revision }, 409);
    const metadata = notesMetadata(payload), body = notesBody(payload), collaborators = await notesAccessUserIds(env, payload.collaborators ?? [], note.owner_id), revision = note.current_revision + 1, now = notesNow(), bodyKey = `${EDITOR_NOTES_R2_PREFIX}${id}/${revision}.json`, bodyText = JSON.stringify(body), hash = await notesSha256(bodyText);
    await env.BUCKET.put(bodyKey, bodyText, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
    const revisionInsert = await env.NOTES_DB.prepare(`INSERT OR IGNORE INTO note_revisions (note_id, revision, author_id, body_key, body_sha256, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM notes WHERE id = ? AND current_revision = ?)`)
      .bind(id, revision, session.id, bodyKey, hash, now, id, expected).run();
    if (!revisionInsert.meta.changes) return apiJson({ error: 'This note changed elsewhere. Reload it before saving.', code: 'REVISION_CONFLICT' }, 409);
    await env.NOTES_DB.batch([
      env.NOTES_DB.prepare('UPDATE notes SET title = ?, lat = ?, lon = ?, start_year = ?, end_year = ?, visibility = ?, publication_status = ?, current_revision = ?, updated_at = ? WHERE id = ? AND current_revision = ?').bind(metadata.title, metadata.lat, metadata.lon, metadata.startYear, metadata.endYear, metadata.visibility, 'published', revision, now, id, expected),
      env.NOTES_DB.prepare('DELETE FROM note_access WHERE note_id = ?').bind(id),
      ...collaborators.map(userId => env.NOTES_DB.prepare("INSERT INTO note_access (note_id, user_id, permission, created_at) VALUES (?, ?, 'edit', ?)").bind(id, userId, now))
    ]);
    return apiJson({ note: { id, ...metadata, author: session.username, updatedAt: now, revision } });
  } catch (error) { return apiJson({ error: error.message || 'Note could not be saved.', code: 'NOTE_WRITE_FAILED' }, 400); }
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

function endpointName(pathname) {
  return pathname.replace(/^\//, '') || 'unknown';
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
    const error = new Error(`FMP ${endpointName(pathname)} request failed: ${message}`);
    error.status = 502;
    error.upstreamStatus = response.status;
    error.endpoint = endpointName(pathname);
    throw error;
  }

  return response.json();
}

function summarizeFmpPayload(payload) {
  if (Array.isArray(payload)) {
    const first = payload.find((item) => item && typeof item === 'object');
    return {
      shape: 'array',
      count: payload.length,
      fields: first ? Object.keys(first).slice(0, 12) : []
    };
  }

  if (payload && typeof payload === 'object') {
    return {
      shape: 'object',
      fields: Object.keys(payload).slice(0, 12)
    };
  }

  return {
    shape: typeof payload,
    fields: []
  };
}

async function probeFmpEndpoint(test, apiKey, fetcher) {
  const startedAt = Date.now();
  const url = buildFmpUrl(test.pathname, test.params);
  const response = await fetcher(url.toString(), {
    headers: {
      Accept: 'application/json',
      apikey: apiKey
    }
  });
  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      id: test.id,
      label: test.label,
      endpoint: endpointName(test.pathname),
      ok: false,
      restricted: response.status === 402
        || response.status === 403
        || /restricted endpoint|current subscription|upgrade your plan/i.test(detail),
      status: response.status,
      durationMs,
      message: detail.slice(0, 220)
    };
  }

  const payload = await response.json().catch(() => null);
  return {
    id: test.id,
    label: test.label,
    endpoint: endpointName(test.pathname),
    ok: true,
    restricted: false,
    status: response.status,
    durationMs,
    sample: summarizeFmpPayload(payload)
  };
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

function staticConstituents() {
  return SP500_STATIC_SYMBOLS.map((symbol) => ({
    symbol,
    name: symbol,
    sector: 'Static fallback',
    subSector: null,
    weightPct: null
  }));
}

function staticUniverseFallback(reason, generatedAt) {
  return {
    rows: staticConstituents(),
    generatedAt,
    cacheHit: false,
    cacheName: 'static-large-cap-universe',
    callsUsed: 0,
    sourceLabel: 'Static large-cap S&P watchlist',
    sourceNote: 'FMP index composition endpoints were unavailable for this subscription, so a bundled large-cap S&P watchlist is weighted by quote market cap.',
    weightMode: 'marketCap',
    fallbackReason: reason
  };
}

async function cacheStaticUniverse(bucket, fallback) {
  await writeR2Json(bucket, SP500_CONSTITUENTS_KEY, {
    generatedAt: fallback.generatedAt,
    source: fallback.sourceLabel,
    sourceNote: fallback.sourceNote,
    cacheName: fallback.cacheName,
    weightMode: fallback.weightMode,
    fallbackReason: fallback.fallbackReason,
    rows: fallback.rows
  });
}

async function getConstituents(bucket, usage, limit, apiKey, fetcher, now, estimatedQuoteCalls) {
  const stored = await loadStoredConstituents(bucket);
  const storedAt = stored?.generatedAt ? new Date(stored.generatedAt) : null;
  const storedFresh = storedAt && Number.isFinite(storedAt.getTime())
    && now.getTime() - storedAt.getTime() < SP500_CONSTITUENTS_TTL_MS;

  if (storedFresh) {
    const storedStatic = stored.cacheName === 'static-large-cap-universe';
    return {
      rows: stored.rows,
      generatedAt: stored.generatedAt,
      cacheHit: true,
      cacheName: stored.cacheName || 'sp500-constituents',
      callsUsed: 0,
      sourceLabel: stored.source || (storedStatic ? 'Static large-cap S&P watchlist' : 'S&P 500 market-cap estimate'),
      sourceNote: stored.sourceNote || (storedStatic
        ? 'FMP index composition endpoints were unavailable for this subscription, so a bundled large-cap S&P watchlist is weighted by quote market cap.'
        : 'SPY holdings were unavailable for this FMP subscription, so S&P 500 constituents are weighted by quote market cap as a practical estimate.'),
      weightMode: stored.weightMode || 'marketCap',
      fallbackReason: stored.fallbackReason || null
    };
  }

  if (!budgetStatus(usage, limit, 2 + estimatedQuoteCalls).canSpend) {
    throw createBudgetError(usage, limit, 2 + estimatedQuoteCalls);
  }

  try {
    const rawConstituents = await fetchFmpJson('/sp500-constituent', {}, apiKey, fetcher);
    await spendCall(bucket, usage, now);

    const rows = normalizeConstituents(rawConstituents);
    if (!rows.length) {
      const fallback = staticUniverseFallback('FMP returned no usable S&P 500 constituents.', now.toISOString());
      fallback.callsUsed = 1;
      await cacheStaticUniverse(bucket, fallback);
      return fallback;
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
  } catch (err) {
    if (!isRestrictedFmpError(err)) {
      throw err;
    }

    await spendCall(bucket, usage, now);
    const fallback = staticUniverseFallback('FMP rejected both SPY holdings and S&P constituent endpoints for this subscription.', now.toISOString());
    fallback.callsUsed = 1;
    await cacheStaticUniverse(bucket, fallback);
    return fallback;
  }
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
      fallbackReason: fallback.fallbackReason || 'FMP rejected the SPY ETF holdings endpoint for this subscription.'
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

async function readCachedDiagnostics(bucket, now) {
  const cached = await readR2Json(bucket, SP500_DIAGNOSTICS_KEY).catch(() => null);
  const cachedAt = cached?.generatedAt ? new Date(cached.generatedAt) : null;
  const isFresh = cachedAt && Number.isFinite(cachedAt.getTime())
    && now.getTime() - cachedAt.getTime() < SP500_DIAGNOSTICS_TTL_MS;

  return { cached, isFresh };
}

async function runFmpDiagnostics(bucket, env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const now = options.now || new Date();
  const apiKey = await getFmpApiKey(env);

  if (!apiKey) {
    return apiJson({
      error: 'FMP_API_KEY is not configured.',
      code: 'MISSING_FMP_API_KEY'
    }, 503);
  }

  const { cached, isFresh } = await readCachedDiagnostics(bucket, now);
  if (isFresh && !options.force) {
    return apiJson({
      ...cached,
      cacheHit: true
    });
  }

  const limit = parseDailyCap(env);
  const usage = await loadUsage(bucket, now);
  const plannedCalls = FMP_DIAGNOSTIC_TESTS.length;
  if (!budgetStatus(usage, limit, plannedCalls).canSpend) {
    return apiJson({
      error: 'Daily FMP call safety cap would be exceeded.',
      code: 'BUDGET_EXCEEDED',
      budget: budgetStatus(usage, limit, plannedCalls)
    }, 429);
  }

  const usedBefore = usage.used;
  const tests = [];
  for (const test of FMP_DIAGNOSTIC_TESTS) {
    const result = await probeFmpEndpoint(test, apiKey, fetcher);
    tests.push(result);
    await spendCall(bucket, usage, now);
  }

  const payload = {
    generatedAt: now.toISOString(),
    cacheHit: false,
    budget: {
      date: usage.date,
      limit,
      usedBefore,
      usedAfter: usage.used,
      remaining: Math.max(0, limit - usage.used),
      callsUsed: usage.used - usedBefore
    },
    summary: {
      ok: tests.filter((test) => test.ok).map((test) => test.id),
      restricted: tests.filter((test) => test.restricted).map((test) => test.id),
      failed: tests.filter((test) => !test.ok && !test.restricted).map((test) => test.id)
    },
    tests
  };

  await writeR2Json(bucket, SP500_DIAGNOSTICS_KEY, payload);
  return apiJson(payload);
}

export async function handleFmpDiagnostics(request, env, options = {}) {
  if (!env.BUCKET) {
    return apiJson({
      error: "R2 Bucket 'BUCKET' not bound.",
      code: 'MISSING_BUCKET'
    }, 503);
  }

  const now = options.now || new Date();
  if (request.method === 'GET') {
    const { cached } = await readCachedDiagnostics(env.BUCKET, now);
    if (!cached) {
      return apiJson({
        error: 'No cached FMP diagnostic report yet. Run POST /api/sp500-impact/diagnostics?run=1.',
        code: 'NO_DIAGNOSTICS'
      }, 404);
    }

    return apiJson({
      ...cached,
      cacheHit: true
    });
  }

  if (request.method === 'POST') {
    const url = new URL(request.url);
    if (url.searchParams.get('run') !== '1') {
      return apiJson({
        error: 'Diagnostics are manual to protect the FMP call budget. Add ?run=1 to run them.',
        code: 'RUN_CONFIRMATION_REQUIRED'
      }, 400);
    }

    return runFmpDiagnostics(env.BUCKET, env, {
      ...options,
      force: url.searchParams.get('force') === '1'
    });
  }

  return apiJson({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
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

    if (url.pathname.replace(/\/$/, '') === '/api/acoustic-states') return handleAcousticStates(request, env);

    // Public, allowlisted ROAD discovery partitions. No user-supplied R2 key is accepted.
    if (url.pathname === '/api/human-atlas/road') return handleRoadExplorer(request, env);
    if (url.pathname === '/api/human-atlas/notes') return request.method === 'GET' ? handleEditorNotes(request, env) : handleEditorNoteWrites(request, env);
    if (url.pathname.startsWith('/api/human-atlas/auth/')) return handleNotesAuth(request, env);
    if (url.pathname.startsWith('/api/human-atlas/admin/')) return handleNotesAdmin(request, env);

    // API Endpoint: /api/sp500-impact/diagnostics
    if (url.pathname === '/api/sp500-impact/diagnostics') {
      return handleFmpDiagnostics(request, env);
    }

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
