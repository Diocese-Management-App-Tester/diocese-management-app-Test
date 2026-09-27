#!/usr/bin/env node
/**
 * demo/local-supabase.mjs — a tiny Supabase emulator for the demo sandbox.
 *
 *   /rest/v1/*      → proxied to PostgREST (port 3001) — real RLS on the seeded DB
 *   /auth/v1/*      → minimal GoTrue: password login (bcrypt vs auth.users),
 *                     token refresh, GET user, logout, signup, PUT user
 *   /storage/v1/*   → objects served from ./storage (empty in demo) → 404
 *   /realtime/v1/*  → websocket that accepts joins & heartbeats (no events)
 *
 * The JWT secret must match demo/postgrest.conf. Only for local demos.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54321);
const POSTGREST = process.env.POSTGREST || 'http://127.0.0.1:3001';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const DB = process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/app';

const pool = new pg.Pool({ connectionString: DB, max: 4 });

// ---------- JWT helpers ----------
const b64 = (s) => Buffer.from(s).toString('base64url');
function signJwt(payload) {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}
function verifyJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
    if (sig !== s) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}

const refreshTokens = new Map(); // refresh → user id

function userJson(row) {
  return {
    id: row.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: row.email,
    email_confirmed_at: row.created_at,
    phone: '',
    confirmed_at: row.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: row.raw_user_meta_data || {},
    identities: [],
    created_at: row.created_at,
    updated_at: new Date().toISOString(),
    is_anonymous: false,
  };
}
function session(row) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600 * 12;
  const access_token = signJwt({
    aud: 'authenticated', exp, iat: now, iss: `http://localhost:${PORT}/auth/v1`,
    sub: row.id, email: row.email, role: 'authenticated',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, session_id: crypto.randomUUID(),
  });
  const refresh_token = crypto.randomBytes(24).toString('base64url');
  refreshTokens.set(refresh_token, row.id);
  return { access_token, token_type: 'bearer', expires_in: exp - now, expires_at: exp, refresh_token, user: userJson(row) };
}

async function userById(id) {
  const { rows } = await pool.query('select id, email, created_at, raw_user_meta_data from auth.users where id = $1', [id]);
  return rows[0] || null;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, range, accept, accept-profile, content-profile, x-upsert, cache-control, x-region',
  'access-control-expose-headers': 'content-range, range-unit, x-total-count, content-location',
  'access-control-max-age': '86400',
};
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', ...CORS, ...headers });
  res.end(data);
}
/** the anon / service keys are plain strings in the demo — only real JWTs go to PostgREST */
const isJwt = (t) => typeof t === 'string' && t.split('.').length === 3;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'demo-service-role-key';
function serviceJwt() {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ role: 'service_role', iss: 'supabase', iat: now, exp: now + 3600 });
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// ---------- auth ----------
async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (path === '/settings') return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });

  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const { rows } = await pool.query(
        `select id, email, created_at, raw_user_meta_data,
                (encrypted_password = crypt($2, encrypted_password)) as ok
           from auth.users where lower(email) = lower($1)`,
        [body.email || '', body.password || '']
      );
      const row = rows[0];
      if (!row || !row.ok) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, msg: 'Invalid login credentials' });
      return send(res, 200, session(row));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      refreshTokens.delete(body.refresh_token);
      const row = await userById(uid);
      if (!row) return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, session(row));
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }

  if (path === '/user') {
    const tok = bearer(req) || '';
    if (tok === SERVICE_KEY) return send(res, 200, {});
    const payload = verifyJwt(tok);
    if (!payload) return send(res, 401, { code: 401, msg: 'invalid JWT' });
    const row = await userById(payload.sub);
    if (!row) return send(res, 401, { code: 401, msg: 'user not found' });
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (body.password) await pool.query(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1`, [row.id, body.password]);
      if (body.email) await pool.query(`update auth.users set email = $2 where id = $1`, [row.id, body.email]);
      return send(res, 200, userJson(await userById(row.id)));
    }
    return send(res, 200, userJson(row));
  }

  if (path === '/logout') return send(res, 204, '');

  if (path === '/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const id = crypto.randomUUID();
    await pool.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', $4, now(), now())`,
      [id, body.email, body.password, JSON.stringify(body.data || {})]
    );
    return send(res, 200, session(await userById(id)));
  }

  // admin API (used by /api/servants/* with the service role) — minimal
  if (path.startsWith('/admin/users')) {
    const m = path.match(/^\/admin\/users\/?([^/]*)$/);
    if (req.method === 'POST' && !m?.[1]) {
      const body = await readBody(req);
      const id = crypto.randomUUID();
      await pool.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, crypt($3, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', $4, now(), now())`,
        [id, body.email, body.password || '000000', JSON.stringify(body.user_metadata || {})]
      );
      return send(res, 200, userJson(await userById(id)));
    }
    if (m?.[1] && req.method === 'PUT') {
      const body = await readBody(req);
      if (body.password) await pool.query(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where id = $1`, [m[1], body.password]);
      if (body.email) await pool.query(`update auth.users set email = $2 where id = $1`, [m[1], body.email]);
      return send(res, 200, userJson(await userById(m[1])));
    }
    if (m?.[1] && req.method === 'DELETE') {
      await pool.query('delete from auth.users where id = $1', [m[1]]);
      return send(res, 200, {});
    }
    if (m?.[1] && req.method === 'GET') {
      const row = await userById(m[1]);
      return row ? send(res, 200, userJson(row)) : send(res, 404, { msg: 'not found' });
    }
  }

  return send(res, 404, { code: 404, msg: `auth: ${path} not emulated` });
}

// ---------- rest proxy ----------
function proxyRest(req, res, url) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const target = new URL(url.pathname.replace(/^\/rest\/v1/, '') + url.search, POSTGREST);
  const headers = { ...req.headers, host: target.host };
  delete headers['apikey'];
  const tok = bearer(req);
  if (tok === SERVICE_KEY) headers.authorization = `Bearer ${serviceJwt()}`;
  else if (!isJwt(tok)) delete headers.authorization; // anon key → anon role
  const p = http.request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode || 502, { ...up.headers, ...CORS });
    up.pipe(res);
  });
  p.on('error', (e) => send(res, 502, { message: 'postgrest unreachable', detail: String(e) }));
  req.pipe(p);
}

// ---------- storage ----------
function handleStorage(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET') { res.writeHead(404); return res.end(); }
  return send(res, 200, { Key: 'demo/none' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/rest/v1')) return proxyRest(req, res, url);
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/storage/v1')) return handleStorage(req, res);
    if (url.pathname === '/' ) return send(res, 200, { ok: true, service: 'local-supabase-demo' });
    return send(res, 404, { msg: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { msg: String(e) });
  }
});

// ---------- realtime (phoenix protocol, accept everything, emit nothing) ----------
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/realtime/v1')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const [joinRef, ref, topic, event] = Array.isArray(msg)
          ? msg
          : [msg.join_ref, msg.ref, msg.topic, msg.event];
        // realtime-js ≥ 2.x speaks the phoenix ARRAY serializer:
        // [join_ref, ref, topic, event, payload]
        const reply = (jr, r, t, ev, payload) => ws.send(JSON.stringify([jr ?? null, r ?? null, t, ev, payload]));
        if (event === 'phx_join') {
          reply(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
          // postgres_changes subscriptions get a "system" ok so the client stays SUBSCRIBED
          reply(joinRef, null, topic, 'system', { status: 'ok', message: 'Subscribed to PostgreSQL', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') });
        } else if (event === 'heartbeat') {
          reply(null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
        } else if (event === 'access_token') {
          // ignore
        } else if (event === 'phx_leave') {
          reply(joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
        } else if (event === 'broadcast') {
          // echo to all other sockets on the same topic
          for (const other of wss.clients) if (other !== ws && other.readyState === 1) other.send(raw.toString());
        }
      } catch { /* ignore */ }
    });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`local-supabase demo gateway on :${PORT} → ${POSTGREST}`));
