import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configuration, createDataService, localDay, normalize, priceDay } from '../data.mjs';
import { createApp } from '../server.mjs';

const code = '012345';
const config = extra => configuration({ ENERGYDECK_WEB_ACCESS_CODE: code, ENERGYDECK_WEB_SECURE_COOKIE: 'false', ...extra });
const device = (values, extra = {}) => ({ capabilitiesObj: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), ...extra });
const day = (date, value = .1) => ({ date, values: Array(96).fill(value), source: 'homey' });

async function fixture(t, settings = config(), options = {}) {
  const server = createApp(settings, { service: { get: async () => ({ private: true }) }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init) => fetch(`${origin}${path}`, init);
  const login = (value = code, headers = {}) => request('/api/login', { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ code: value }) });
  return { request, login, origin };
}

test('configuration fails closed and never includes the access code in errors', () => {
  assert.throws(() => configuration({}), /exactly 6 digits/);
  assert.throws(() => config({ HOMEY_ADDRESS: 'https://user:password@example.com' }), /Invalid HOMEY_ADDRESS/);
  assert.throws(() => config({ HOMEY_ADDRESS: 'file:///etc/passwd' }), /Invalid HOMEY_ADDRESS/);
  assert.throws(() => config({ ENERGYDECK_VAT_PERCENT: 'unknown' }), /Invalid/);
  assert.equal(config({ ENERGYDECK_VAT_PERCENT: '' }).vat, 21);
  assert.equal(configuration({ ENERGYDECK_WEB_ACCESS_CODE: code }).secureCookie, true);
  assert.throws(() => config({ ENERGYDECK_WEB_ORIGIN: 'https://deck.example' }), /HTTPS requires/);
});

test('PINs contain exactly six ASCII digits and preserve leading zeroes', async t => {
  assert.equal(config().accessCode, '012345');
  for (const value of ['12345', '1234567', 'abcdef', '１２３４５６', '123456\n', ' 123456', 123456]) {
    assert.throws(() => config({ ENERGYDECK_WEB_ACCESS_CODE: value }), /exactly 6 digits/);
  }
  const { login } = await fixture(t);
  for (const value of [12345, '12345', '012345\n']) assert.equal((await login(value)).status, 401);
  assert.equal((await login('012345')).status, 200);
});

test('PIN login throttling permits a retry after the one-minute window', async t => {
  let now = 1000;
  const { login } = await fixture(t, config(), { clock: () => now });
  for (let i = 0; i < 5; ++i) assert.equal((await login('999999')).status, 401);
  assert.equal((await login()).status, 429);
  now += 60000;
  assert.equal((await login()).status, 200);
});

test('Amsterdam calendar boundaries handle DST and tomorrow correctly', () => {
  assert.equal(localDay(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(localDay(new Date('2026-10-25T12:00:00Z'), 1), '2026-10-26');
  assert.equal(localDay(new Date('2026-03-29T12:00:00Z'), 1), '2026-03-30');
});

test('all-in prices use firmware tax/fee units and preserve provenance', () => {
  const bridge = { today: day('2026-10-21'), cachedDays: ['2026-10-21'] };
  const result = priceDay(bridge, '2026-10-21', config());
  assert.ok(Math.abs(result.values[0] - ((10 + 9.161) * 1.21 + 2)) < 1e-10);
  assert.equal(result.cached, true);
  assert.equal(result.source, 'homey');
  assert.equal(result.cheapest, 0);
});

test('price provenance matches ESP per-day and legacy date-keyed sources', () => {
  const today = '2026-10-21', tomorrow = '2026-10-22';
  const cases = [
    [{ source: 'homey' }, { [today]: 'EpexPrijzen.nl (raw EUR/kWh)' }, 'homey'],
    [{ source: 'epexprijzen' }, { [today]: 'Homey' }, 'epexprijzen'],
    [{}, { [today]: 'Homey' }, 'homey'],
    [{}, { [today]: 'EpexPrijzen.nl (raw EUR/kWh)' }, 'epexprijzen'],
    [{ source: 'Homey' }, {}, 'homey'],
    [{ source: 'EpexPrijzen.nl (raw EUR/kWh)' }, {}, 'epexprijzen'],
    [{ source: 'unknown' }, { [today]: 'Homey' }, 'unknown'],
    [{ source: 'unavailable' }, { [today]: 'Homey' }, 'unknown'],
    [{ source: null }, { [today]: 'Homey' }, 'unknown'],
    [{}, { [tomorrow]: 'Homey' }, 'unknown'],
    [{}, { [today]: 'Geen' }, 'unknown'],
    [{}, {}, 'unknown'],
  ];
  for (const [metadata, sources, expected] of cases) {
    const bridge = { today: { date: today, values: Array(96).fill(.1), ...metadata },
      tomorrow: { date: tomorrow, values: Array(96).fill(.2), source: 'homey' }, sources,
      warnings: ['EpexPrijzen'], cachedDays: [today] };
    assert.equal(priceDay(bridge, today, config()).source, expected);
    assert.equal(priceDay(bridge, tomorrow, config()).source, 'homey');
    assert.equal(priceDay(bridge, today, config()).cached, true);
  }
});

test('prices reject stale dates, missing quarters and nonnumeric values', () => {
  assert.equal(priceDay({ today: day('2026-10-20') }, '2026-10-21', config()), null);
  for (const values of [Array(92).fill(.1), Array(100).fill(.1), [...Array(95).fill(.1), null], [...Array(95).fill(.1), '.1']]) {
    assert.equal(priceDay({ today: { date: '2026-10-21', values } }, '2026-10-21', config()), null);
  }
  const bridge = { tomorrow: day('2026-10-21') };
  assert.ok(priceDay(bridge, '2026-10-21', config()));
});

test('cheapest window includes the final 3-hour interval and negative prices', () => {
  const selected = day('2026-10-21'); selected.values.fill(-.3, 84);
  const result = priceDay({ today: selected }, selected.date, config());
  assert.equal(result.cheapest, 84);
  assert.ok(result.minimum < 0);
});

test('normalization preserves zeroes, sign conventions, and missing metrics', () => {
  const value = normalize({ grid: device({ measure_power: -940, measure_gas: 0 }),
    solar: device({ measure_power: 0 }), battery: device({ measure_battery: 74, 'measure_power.battery': -860, measure_power: 100 }),
    charger: device({ is_charging: false, is_connected: false }) }, [], null, config());
  assert.equal(value.grid.power, -940); assert.equal(value.gas.rate, 0);
  assert.equal(value.solar.power, 0); assert.equal(value.grid.today, null);
  assert.equal(value.battery.power, -860); assert.equal(value.charger.connected, false);
});

test('offline devices and non-Evohome sensors never supply live measurements', () => {
  const value = normalize({ battery: device({ measure_battery: 150, measure_power: 12 }, { available: false }) },
    [{ device: device({ measure_temperature: 23, target_temperature: 21 }, { driverId: 'other' }) },
      { name: 'Kitchen', device: device({ measure_temperature: 0, target_temperature: 20 }, { driverId: 'homey:app:com.honeywell:zone' }) }], null, config());
  assert.equal(value.battery.percentage, null); assert.equal(value.battery.power, null);
  assert.equal(value.rooms[0].temperature, null); assert.equal(value.rooms[1].temperature, 0);
});

test('data service shares requests, bounds concurrency, and keeps credentials upstream', async () => {
  let count = 0, active = 0, peak = 0;
  const settings = config({ HOMEY_ADDRESS: 'http://homey.test', HOMEY_TOKEN: 'private-homey-token', HOMEY_HOMEWIZARD_DEVICE_ID: 'grid',
    HOMEY_SESSY_DEVICE_ID: 'battery', HOMEY_SOLAR_DEVICE_ID: 'solar', HOMEY_GAS_SUMMARY_DEVICE_ID: 'gas', HOMEY_PRICES_VARIABLE_ID: 'prices' });
  const fetcher = async (url, options) => {
    count++; active++; peak = Math.max(peak, active);
    assert.equal(options.headers.Authorization, 'Bearer private-homey-token');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, undefined);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return Response.json(url.endsWith('/prices') ? { value: JSON.stringify({ today: day('2026-10-21') }) } : device({ measure_power: 0 }));
  };
  const service = createDataService(settings, fetcher, () => new Date('2026-10-21T12:00:00Z'));
  const [a, b] = await Promise.all([service.get(), service.get()]);
  assert.equal(a, b); assert.equal(await service.get(), a); assert.equal(count, 5); assert.ok(peak <= 3);
  assert.equal(a.status, 'online'); assert.ok(!JSON.stringify(a).includes('private-homey-token'));
});

test('refresh clears failed readings rather than carrying stale live metrics', async () => {
  let fail = false, now = new Date('2026-10-21T12:00:00Z');
  const service = createDataService(config({ HOMEY_ADDRESS: 'http://homey.test', HOMEY_TOKEN: 'token', HOMEY_HOMEWIZARD_DEVICE_ID: 'grid' }),
    async () => { if (fail) throw new Error('secret details'); return Response.json(device({ measure_power: 123 })); }, () => now);
  assert.equal((await service.get()).grid.power, 123);
  fail = true; now = new Date(now.getTime() + 16000);
  const value = await service.get();
  assert.equal(value.grid.power, null); assert.equal(value.status, 'partial'); assert.deepEqual(value.errors, ['grid']);
  assert.ok(!JSON.stringify(value).includes('secret details'));
});

test('day rollover invalidates cache, and demodata is explicitly marked', async () => {
  let now = new Date('2026-10-21T21:59:59Z');
  const service = createDataService(config({ ENERGYDECK_WEB_DEMO: 'true' }), () => { throw new Error('must not fetch'); }, () => now);
  const a = await service.get(); now = new Date('2026-10-21T22:00:01Z'); const b = await service.get();
  assert.equal(a.demo, true); assert.equal(a.day, '2026-10-21'); assert.equal(b.day, '2026-10-22');
  assert.equal(b.status, 'demo');
});

test('unconfigured service does not call Homey', async () => {
  const value = await createDataService(config(), () => { throw new Error('must not fetch'); }).get();
  assert.equal(value.status, 'unconfigured'); assert.equal(value.demo, false);
});

test('oversized upstream responses are discarded and marked unavailable', async () => {
  const service = createDataService(config({ HOMEY_ADDRESS: 'http://homey.test', HOMEY_TOKEN: 'token', HOMEY_HOMEWIZARD_DEVICE_ID: 'grid' }),
    async () => new Response('x'.repeat(1024 * 1024 + 1)));
  const value = await service.get();
  assert.equal(value.status, 'partial'); assert.equal(value.grid.power, null);
});

test('session rotation revokes the old cookie and server errors reveal no details', async t => {
  let fail = false;
  const { login, request } = await fixture(t, config(), { service: { get: async () => {
    if (fail) throw new Error('private-token-and-address');
    return { ok: true };
  } } });
  const old = (await login()).headers.get('set-cookie').split(';')[0];
  const next = (await login(code, { Cookie: old })).headers.get('set-cookie').split(';')[0];
  assert.notEqual(old, next);
  assert.equal((await request('/api/dashboard', { headers: { Cookie: old } })).status, 401);
  fail = true;
  const response = await request('/api/dashboard', { headers: { Cookie: next } });
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'unavailable' });
});

test('private APIs require cookies, never query-string access codes', async t => {
  const { request } = await fixture(t);
  for (const path of ['/api/dashboard', `/api/dashboard?code=${code}`, '/api/session', '/api/sonos', '/api/weather', '/api/history', '/api/battery/history', `/api/sonos/artwork/${'a'.repeat(64)}`]) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/healthz')).status, 200);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/data.mjs')).status, 404);
});

test('login creates an HttpOnly session; logout invalidates copied cookies', async t => {
  const { request, login, origin } = await fixture(t);
  assert.equal((await login('wrong')).status, 401);
  const response = await login(); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=604800/);
  assert.ok(!cookie.includes(code));
  const headers = { Cookie: cookie.split(';')[0] };
  assert.deepEqual(await (await request('/api/dashboard', { headers })).json(), { private: true });
  assert.equal((await request('/api/charge', { method: 'POST', headers })).status, 403);
  assert.equal((await request('/api/unsupported', { method: 'POST', headers })).status, 405);
  const out = await request('/api/logout', { method: 'POST', headers: { ...headers, Origin: origin } });
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/dashboard', { headers })).status, 401);
});

test('secure cookies default to the __Host prefix and expire after seven days', async t => {
  let now = Date.now();
  const { login, request } = await fixture(t, configuration({ ENERGYDECK_WEB_ACCESS_CODE: code }), { clock: () => now });
  const response = await login(); const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-energydeck=/); assert.match(cookie, /; Secure/);
  now += 7 * 24 * 3600000 + 1;
  assert.equal((await request('/api/dashboard', { headers: { Cookie: cookie.split(';')[0] } })).status, 401);
});

test('cross-site and missing-origin login/logout requests are rejected', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await login(code, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await login(code, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })).status, 403);
  assert.equal((await request('/api/logout', { method: 'POST' })).status, 403);
});

test('TLS proxy origin is explicitly configured and forwarded headers are ignored', async t => {
  const { login } = await fixture(t, configuration({ ENERGYDECK_WEB_ACCESS_CODE: code, ENERGYDECK_WEB_ORIGIN: 'https://deck.example' }));
  assert.equal((await login(code, { Origin: 'https://deck.example' })).status, 200);
  assert.equal((await login(code, { Origin: 'https://evil.example', 'X-Forwarded-Host': 'evil.example' })).status, 403);
});

test('login is rate limited even with forged forwarding headers', async t => {
  const { login } = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await login('wrong', { 'X-Forwarded-For': `10.0.0.${i}` })).status, 401);
  const response = await login(); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
});

test('invalid and oversized login bodies fail safely', async t => {
  const { request, origin } = await fixture(t);
  for (const body of ['{invalid', 'null', JSON.stringify({ code: 'a'.repeat(2100) })]) {
    const response = await request('/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body });
    assert.ok([400, 401].includes(response.status));
  }
});

test('static responses forbid framing, caching and third-party resources', async t => {
  const { request } = await fixture(t);
  const response = await request('/'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /id="login"/);
  assert.equal((await request('/app.js')).status, 200);
  assert.equal((await request('/sunshine.js')).status, 200);
});

test('Dutch and English translations cover all HTML keys and have matching keys', async () => {
  const strings = JSON.parse(await readFile(new URL('../public/translations.json', import.meta.url)));
  assert.deepEqual(Object.keys(strings.nl).sort(), Object.keys(strings.en).sort());
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) assert.ok(strings.nl[match[1]], match[1]);
});
