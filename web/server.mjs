import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { configuration, createDataService } from './data.mjs';
import { createExtrasService } from './extras.mjs';
import { createSonosService } from './sonos.mjs';
import { AppError } from './net.mjs';

const digest = value => createHash('sha256').update(value).digest();
const sessionLife = 7 * 24 * 3600 * 1000;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/translations.json', ['translations.json', 'application/json; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
  ['/favicon.ico', ['favicon.ico', 'image/vnd.microsoft.icon']],
  ['/apple-touch-icon.png', ['apple-touch-icon.png', 'image/png']],
  ['/icon-192.png', ['icon-192.png', 'image/png']],
  ['/icon-512.png', ['icon-512.png', 'image/png']],
  ['/details.js', ['details.js', 'text/javascript; charset=utf-8']],
  ['/details.css', ['details.css', 'text/css; charset=utf-8']],
  ['/charts.js', ['charts.js', 'text/javascript; charset=utf-8']],
  ['/display.js', ['display.js', 'text/javascript; charset=utf-8']],
  ['/fonts/Montserrat-Medium.ttf', ['fonts/Montserrat-Medium.ttf', 'font/ttf']],
  ['/fonts/OFL.txt', ['fonts/OFL.txt', 'text/plain; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
]);

export function createApp(config, { service = createDataService(config), extras = createExtrasService(config), sonos = createSonosService(config), clock = Date.now } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const controlAttempts = new Map();
  const secret = digest(config.accessCode);
  const cookieName = config.secureCookie ? '__Host-energydeck' : 'energydeck';
  let globalAttempts = { count: 0, until: 0 };
  const cookie = (token, age) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secureCookie ? '; Secure' : ''}`;
  const reply = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = digest(token).toString('hex');
    const value = sessions.get(key);
    if (!value || value <= clock()) { sessions.delete(key); return null; }
    return key;
  }
  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    try {
      const source = new URL(req.headers.origin);
      // Explicit origin is needed behind TLS proxies; forwarded headers are untrusted.
      return config.origin ? source.origin === config.origin :
        ['http:', 'https:'].includes(source.protocol) && source.host === req.headers.host;
    } catch { return false; }
  }
  async function jsonBody(req, limit = 2048) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('body');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new Error('body');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  function rateLimited(req) {
    const now = clock();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (globalAttempts.until <= now) globalAttempts = { count: 0, until: now + 60000 };
    // Socket addresses cannot be forged with X-Forwarded-For. Proxied users share a limit.
    const ip = req.socket.remoteAddress;
    const value = attempts.get(ip) || { count: 0, until: now + 60000 };
    if (value.count >= 5 || globalAttempts.count >= 20 || (!attempts.has(ip) && attempts.size >= 1024)) return true;
    value.count++; globalAttempts.count++; attempts.set(ip, value);
    return false;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://energydeck.local');
      if (req.method === 'GET' && url.pathname === '/healthz') return reply(res, 200, { ok: true });
      if (req.method === 'POST' && ['/api/login', '/api/logout'].includes(url.pathname)) {
        if (!sameOrigin(req)) return reply(res, 403, { error: 'origin' });
        if (url.pathname === '/api/logout') {
          const key = session(req);
          if (key) sessions.delete(key);
          res.setHeader('Set-Cookie', cookie('', 0));
          return reply(res, 200, { ok: true });
        }
        if (rateLimited(req)) {
          res.setHeader('Retry-After', '60');
          return reply(res, 429, { error: 'rateLimited' });
        }
        let body;
        try { body = await jsonBody(req); } catch { return reply(res, 400, { error: 'invalidRequest' }); }
        if (typeof body?.code !== 'string' || body.code.length !== 6 || !/^[0-9]{6}$/.test(body.code) || !timingSafeEqual(digest(body.code), secret)) {
          return reply(res, 401, { error: 'invalidCode' });
        }
        const now = clock();
        for (const [key, until] of sessions) if (until <= now) sessions.delete(key);
        const old = session(req);
        if (old) sessions.delete(old);
        if (sessions.size >= 256) return reply(res, 503, { error: 'sessionLimit' });
        const token = randomBytes(32).toString('hex');
        sessions.set(digest(token).toString('hex'), now + sessionLife);
        res.setHeader('Set-Cookie', cookie(token, sessionLife / 1000));
        return reply(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        const key = session(req);
        if (!key) return reply(res, 401, { error: 'unauthorized' });
        if (req.method === 'POST' && ['/api/charge', '/api/sonos/command'].includes(url.pathname)) {
          if (!sameOrigin(req)) return reply(res, 403, { error: 'origin' });
          const now = clock();
          for (const [id, entry] of controlAttempts) if (entry.until <= now) controlAttempts.delete(id);
          const entry = controlAttempts.get(key) || { until: now + 60000, count: 0 };
          if (++entry.count > 60) return reply(res, 429, { error: 'rateLimited' });
          controlAttempts.set(key, entry);
          let body;
          try { body = await jsonBody(req, 8192); } catch { return reply(res, 400, { error: 'invalidRequest' }); }
          const result = url.pathname === '/api/charge' ? await extras.charge(body) : await sonos.command(body);
          if (url.pathname === '/api/charge') service.invalidate?.();
          return reply(res, 200, result);
        }
        if (req.method !== 'GET') return reply(res, 405, { error: 'readOnly' });
        if (url.pathname === '/api/session') return reply(res, 200, { ok: true });
        if (url.pathname === '/api/dashboard') return reply(res, 200, await service.get());
        if (url.pathname === '/api/history') return reply(res, 200, await extras.history());
        if (url.pathname === '/api/weather') return reply(res, 200, await extras.weather());
        if (url.pathname === '/api/sonos') return reply(res, 200, await sonos.get(url.searchParams.get('room') || '', url.searchParams.get('favorites') === 'true', url.searchParams.get('combined') === 'true'));
        if (/^\/api\/sonos\/artwork\/[a-f0-9]{64}$/.test(url.pathname)) {
          const asset = await sonos.artwork(url.pathname.split('/').at(-1));
          res.writeHead(200, { 'Content-Type': asset.type }); return res.end(asset.body);
        }
        return reply(res, 404, { error: 'notFound' });
      }
      if (req.method === 'GET' && /^\/stations\/[a-z0-9-]+\.jpg$/.test(url.pathname)) {
        try {
          const body = await readFile(new URL(`./public${url.pathname}`, import.meta.url));
          res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(body);
        } catch { return reply(res, 404, { error: 'notFound' }); }
      }
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const body = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type });
        return res.end(body);
      }
      return reply(res, 404, { error: 'notFound' });
    } catch (error) {
      // Never send upstream errors, addresses, credentials, or request URLs to clients/logs.
      if (!res.headersSent) reply(res, error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.code : 'unavailable' });
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const config = configuration();
    const port = Number(process.env.ENERGYDECK_WEB_PORT || 8080);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ENERGYDECK_WEB_PORT');
    const server = createApp(config);
    server.listen(port, process.env.ENERGYDECK_WEB_HOST || '0.0.0.0', () => {
      console.log(`EnergyDeck web listening on port ${port}${config.demo ? ' (DEMO)' : ''}`);
    });
    server.on('error', error => { console.error(`Server failed: ${error.code || 'unknown'}`); process.exit(1); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch (error) { console.error(error.message); process.exit(1); }
}
