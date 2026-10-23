import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { configuration, createDataService } from '../data.mjs';
import { createApp } from '../server.mjs';
import { createDashboardStream } from '../live.mjs';
import { watchHomey } from '../realtime.mjs';
import { createLiveUpdates } from '../public/live.js';

const config = configuration({ ENERGYDECK_WEB_ACCESS_CODE: '012345', ENERGYDECK_WEB_SECURE_COOKIE: 'false' });
const turn = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class Response extends EventEmitter {
  chunks = [];
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(value) { this.chunks.push(value); return true; }
  end() { this.emit('close'); }
  destroy() { this.end(); }
  events() { return this.chunks.join(''); }
}

test('one shared Homey watcher pushes to multiple clients and coalesces meter bursts', async t => {
  let changed, reads = 0, starts = 0, stops = 0;
  const stream = createDashboardStream(config, { get: async () => ({ power: ++reads }), invalidate() {} }, () => true,
    { watch: (_, callback) => { starts++; changed = callback; return () => { stops++; }; }, debounce: 5 });
  t.after(() => stream.close());
  const a = new Response(), b = new Response();
  stream.open(a, 'a'); stream.open(b, 'b');
  await turn(); await delay(15);
  a.chunks = []; b.chunks = []; reads = 0;
  changed(); changed(); changed();
  await delay(15);
  assert.equal(reads, 1); assert.equal(starts, 1);
  assert.match(a.events(), /event: dashboard\ndata: {"power":1}/);
  assert.equal(a.events(), b.events());
  a.end(); assert.equal(stops, 0); b.end(); assert.equal(stops, 1);
});

test('shared fallback reconciles missed events, fails closed, and enforces session expiry', async t => {
  let valid = true, failed = false, reads = 0;
  const stream = createDashboardStream(config, { get: async () => { reads++; if (failed) throw new Error('private upstream'); return { power: reads }; } }, () => valid,
    { watch: () => () => {}, interval: 10 });
  t.after(() => stream.close());
  const res = new Response(); stream.open(res, 'a');
  await turn(); failed = true; await delay(25);
  assert.match(res.events(), /event: unavailable/);
  assert.doesNotMatch(res.events(), /private upstream/);
  failed = false; await delay(25);
  assert.match(res.events(), /"power":[2-9]/);
  valid = false; await delay(25);
  assert.match(res.events(), /event: unauthorized/);
  const before = reads; await delay(25); assert.equal(reads, before);
});

test('an invalidation during a Homey read cannot receive a fresh cache lifetime', async () => {
  const wait = deferred(); let reads = 0;
  const service = createDataService({ ...config, address: 'http://homey.test', token: 'test', devices: { grid: 'grid' } }, async () => {
    reads++; if (reads === 1) await wait.promise;
    return ResponseJSON({ capabilitiesObj: { measure_power: { value: reads } } });
  });
  const first = service.get(); service.invalidate(); wait.resolve(); await first;
  assert.equal((await service.get()).grid.power, 2);
});
function ResponseJSON(value) { return new globalThis.Response(JSON.stringify(value)); }

test('Homey subscriptions are restricted to configured IDs and reconnects reconcile data', async () => {
  const subscriptions = new Map(); let changes = 0, destroyed = 0;
  const stop = watchHomey({ ...config, address: 'http://homey.test', token: 'private', devices: { grid: 'meter', solar: 'meter', gas: 'none' },
    controller: 'controller', rooms: [{ id: 'zone' }], prices: 'prices' }, () => changes++, async () => ({
    subscribe: async (uri, handlers) => { subscriptions.set(uri, handlers); }, destroy: () => destroyed++,
  }));
  await turn();
  assert.deepEqual([...subscriptions.keys()], ['homey:device:meter', 'homey:device:zone', 'homey:device:controller', 'homey:manager:logic']);
  const initial = changes;
  subscriptions.get('homey:device:meter').onEvent('capability', { value: 800 });
  subscriptions.get('homey:manager:logic').onEvent('variable.update', { id: 'unrelated' });
  assert.equal(changes, initial + 1);
  subscriptions.get('homey:manager:logic').onEvent('variable.update', { id: 'prices' });
  subscriptions.get('homey:device:meter').onReconnect();
  assert.equal(changes, initial + 3);
  stop(); assert.equal(destroyed, 1);
});

test('closing while Homey setup is pending destroys the late connection', async () => {
  const wait = deferred(); let destroyed = 0, changes = 0;
  const stop = watchHomey({ ...config, address: 'http://homey.test', token: 'test' }, () => changes++, () => wait.promise);
  stop(); wait.resolve({ destroy: () => destroyed++ }); await turn();
  assert.equal(destroyed, 1); assert.equal(changes, 0);
});

class Source {
  static instances = [];
  handlers = {};
  constructor(url) { this.url = url; Source.instances.push(this); }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  close() { this.closed = true; }
}
test('browser reconnects, enables REST fallback on failure, and ignores old session events', async () => {
  let value = null, unavailable = 0, unauthorized = 0;
  const live = createLiveUpdates({ Source, onDashboard: next => value = next, onUnavailable: () => unavailable++, onUnauthorized: () => unauthorized++, checkSession: async () => ({ status: 401 }) });
  live.start(); const first = Source.instances.at(-1);
  first.onopen(); assert.equal(live.connected, true);
  first.handlers.dashboard({ data: '{"power":940}' }); assert.equal(value.power, 940);
  await first.onerror(); assert.equal(live.connected, false);
  assert.equal(unavailable, 1); assert.equal(unauthorized, 1); assert.equal(first.closed, true);
  first.handlers.dashboard({ data: '{"power":999}' }); assert.equal(value.power, 940);
  live.start(); const next = Source.instances.at(-1); next.onopen(); assert.equal(live.connected, true);
  live.stop(); assert.equal(next.closed, true);
});

test('SSE uses cookie authentication, sends normalized snapshots and revokes on logout', async t => {
  const server = createApp(config, { service: { get: async () => ({ grid: { power: 940 } }) }, liveOptions: { watch: () => () => {} } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + '/api/events')).status, 401);
  const login = await fetch(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"code":"012345"}' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(origin + '/api/events', { headers: { Cookie: cookie } });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  let first = '';
  while (!first.includes('event: dashboard')) first += new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: dashboard\ndata: {"grid":{"power":940}}/);
  await fetch(origin + '/api/logout', { method: 'POST', headers: { Origin: origin, Cookie: cookie } });
  const last = new TextDecoder().decode((await reader.read()).value);
  assert.match(last, /event: unauthorized/);
  assert.equal((await reader.read()).done, true);
});
