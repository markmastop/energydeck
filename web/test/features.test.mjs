import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, climateState } from '../data.mjs';
import { createExtrasService, dayBounds, historySeries, rainSeries, temperatureInThreeHours } from '../extras.mjs';
import { createSonosService, escapeXml, parseXml, parseTopology, planGroup, sourceMatches, speakerOrigin, stationArtwork } from '../sonos.mjs';
import { priceWindow, lineSegments } from '../public/charts.js';
import { createApp } from '../server.mjs';

const now = new Date('2026-10-21T10:00:00Z');
const config = values => configuration({ ENERGYDECK_WEB_ACCESS_CODE: 'test-only-access-code-0123456789abcdef', HOMEY_ADDRESS: 'http://192.168.1.100', HOMEY_TOKEN: 'test-only-homey-token', ...values });
const device = (values, driverId) => ({ driverId, capabilitiesObj: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) });
const room = (temperature, target) => ({ device: device({ measure_temperature: temperature, target_temperature: target }, 'homey:app:com.honeywell:zone') });

test('controller mode, incomplete rooms and precision determine inferred climate demand', () => {
  const controller = mode => device({ honeywell_thermostat_mode: mode }, 'homey:app:com.honeywell:thermostat');
  assert.equal(climateState(controller('HeatingOff'), [room(18, 21)]).demand, 'off');
  assert.equal(climateState(controller('Auto'), [room(20, 20), room(null, 21)]).demand, 'unknown');
  assert.equal(climateState(controller('Auto'), [room(20, 20.01)]).demand, 'idle');
  assert.equal(climateState(controller('Auto'), [room(20, 20.1), room(null, 21)]).demand, 'demand');
  assert.equal(climateState(null, [room(18, 21)]).demand, 'unknown');
});

test('history day boundaries contain 23 and 25 real hours across DST', () => {
  for (const [date, hours] of [['2026-03-29T12:00:00Z', 23], ['2026-10-25T12:00:00Z', 25], ['2026-10-21T12:00:00Z', 24]]) {
    const { start, end } = dayBounds(new Date(date)); assert.equal(end - start, hours * 3600000);
  }
});

test('history rejects stale, future, duplicate and invalid samples and preserves sign', () => {
  const raw = { values: [{ t: '2026-10-21T09:50:00Z', v: -1000 }, { t: '2026-10-21T09:55:00Z', v: 0 },
    { t: '2026-10-21T09:55:00Z', v: 1 }, { t: '2026-10-21T10:05:00Z', v: 20 }, { t: '2026-10-21T10:00:00', v: 3 }] };
  assert.deepEqual(historySeries(raw, now, true).points.map(p => p.value), [-1, 0]);
  assert.deepEqual(historySeries(raw, new Date('2026-10-21T11:00:00Z'), true).points, []);
  assert.deepEqual(historySeries({ values: [{ t: '2026-10-21T09:55:00Z', v: -.1 }] }, now).points, []);
});

test('history drawing keeps missing samples open and splits import/export exactly at zero', () => {
  const points = [{ time: 0, value: 1 }, { time: 300000, value: -1 }, { time: 900000, value: 3 }];
  const segments = lineSegments(points, true);
  assert.equal(segments.length, 2); assert.deepEqual(segments[0][1], { time: 150000, value: 0 });
  assert.deepEqual(segments[1][0], segments[0][1]);
});

test('price chart rolls from noon into tomorrow only with valid tomorrow input', () => {
  const today = { values: Array.from({ length: 96 }, (_, i) => i) }, tomorrow = { values: Array(96).fill(-3) };
  assert.equal(priceWindow(today, tomorrow, 47).offset, 0);
  assert.equal(priceWindow(today, null, 70).offset, 0);
  const window = priceWindow(today, tomorrow, 70);
  assert.equal(window.values.length, 96); assert.equal(window.values[0], 48); assert.equal(window.values[48], -3);
  assert.equal(window.cheapest, 48); assert.equal(window.minimum, -3);
});

test('rain validates cadence, freshness and units, including midnight', () => {
  const stamp = i => `${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
  const raw = Array.from({ length: 25 }, (_, i) => `${i === 1 ? 109 : 0}|${stamp(720 + i * 5)}`).join('\n');
  const result = rainSeries(raw, now); assert.equal(result.points.length, 24); assert.equal(result.points[1].value, 1);
  assert.equal(rainSeries(raw.replace('12:05', '12:06'), now), null);
  assert.equal(rainSeries(raw, new Date('2026-10-21T11:00:00Z')), null);
  const midnight = Array.from({ length: 24 }, (_, i) => `0|${stamp(1435 + i * 5)}`).join('\n');
  assert.equal(rainSeries(midnight, new Date('2026-10-21T21:55:00Z')).points.length, 24);
});

test('three-hour forecast interpolates between UTC hours rather than choosing a rounded hour', () => {
  const current = new Date('2026-10-21T10:30:00Z');
  assert.equal(temperatureInThreeHours({ time: [Date.parse('2026-10-21T13:00:00Z') / 1000, Date.parse('2026-10-21T14:00:00Z') / 1000], temperature_2m: [10, 14] }, current), 12);
  assert.equal(temperatureInThreeHours({ time: [1, 3], temperature_2m: [10, 14] }, current), null);
});

test('charge requires confirmation and readiness; a network ambiguity never triggers a fallback/retry', async () => {
  const calls = [];
  const service = createExtrasService(config({ HOMEY_CHARGE_FLOW_ID: 'flow', HOMEY_CHARGER_DEVICE_ID: 'charger' }), async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'POST') throw new Error('response lost');
    return Response.json(device({ is_connected: true, is_charging: false, alarm_device: false }));
  }, () => now);
  await assert.rejects(service.charge({}), error => error.code === 'confirmationRequired');
  await assert.rejects(service.charge({ confirm: true, target: true }));
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  await assert.rejects(service.charge({ confirm: true, target: true }), error => error.code === 'commandBusy');
  assert.equal(calls.length, 2);
});

test('charge regular Flow fallback happens only after a definitive advanced-Flow 404', async () => {
  const calls = [];
  const service = createExtrasService(config({ HOMEY_CHARGE_FLOW_ID: 'flow', HOMEY_CHARGER_DEVICE_ID: 'charger' }), async (url, options) => {
    calls.push(url);
    if (!options.method) return Response.json(device({ is_connected: true, is_charging: false, alarm_device: false }));
    return url.includes('advancedflow') ? new Response('{}', { status: 404 }) : Response.json({ ok: true });
  }, () => now);
  assert.equal((await service.charge({ confirm: true, target: true })).ok, true);
  assert.equal(calls.length, 3); assert.ok(calls[2].includes('/flow/flow/flow/trigger'));
});

test('charging/faulted/disconnected devices cannot trigger a charge Flow', async () => {
  for (const values of [{ is_connected: false, is_charging: false, alarm_device: false }, { is_connected: true, is_charging: true, alarm_device: false }, { is_connected: true, is_charging: false, alarm_device: true }]) {
    let writes = 0;
    const service = createExtrasService(config({ HOMEY_CHARGE_FLOW_ID: 'flow', HOMEY_CHARGER_DEVICE_ID: 'charger' }), async (_, options) => { if (options.method) writes++; return Response.json(device(values)); }, () => now);
    await assert.rejects(service.charge({ confirm: true, target: true }), error => error.code === 'chargerNotReady'); assert.equal(writes, 0);
  }
});

test('the same Flow can stop after a verified start while stale target commands are rejected', async () => {
  let charging = false, writes = 0;
  const service = createExtrasService(config({ HOMEY_CHARGE_FLOW_ID: 'flow', HOMEY_CHARGER_DEVICE_ID: 'charger' }), async (_, options) => {
    if (options.method === 'POST') { writes++; charging = !charging; return Response.json({ ok: true }); }
    return Response.json(device({ is_connected: true, is_charging: charging, alarm_device: false }));
  }, () => now);
  await assert.rejects(service.charge({ confirm: true, target: false }), error => error.code === 'chargerNotReady');
  assert.equal(writes, 0);
  await service.charge({ confirm: true, target: true }); assert.equal(charging, true);
  await service.charge({ confirm: true, target: false }); assert.equal(charging, false); assert.equal(writes, 2);
  await assert.rejects(service.charge({ confirm: true, target: false }), error => error.code === 'commandBusy');
});

const origins = ['http://192.168.1.10:1400', 'http://192.168.1.11:1400', 'http://192.168.1.12:1400'];
const seedRooms = () => [{ id: 'A', name: 'Living', coordinator: 'A', origin: origins[0] }, { id: 'B', name: 'Kitchen', coordinator: 'A', origin: origins[1] }, { id: 'C', name: 'Bedroom', coordinator: 'C', origin: origins[2] }];
const topologyXml = rooms => `<ZoneGroups>${[...new Set(rooms.map(room => room.coordinator))].map(coordinator => `<ZoneGroup Coordinator="${coordinator}">${rooms.filter(room => room.coordinator === coordinator).map(room => `<ZoneGroupMember UUID="${room.id}" ZoneName="${room.name}" Location="${room.origin}/xml/device_description.xml"${room.hidden ? ' Invisible="1"' : ''}/>`).join('')}</ZoneGroup>`).join('')}</ZoneGroups>`;
const didl = (title = 'Test track', art = '') => `<DIDL-Lite xmlns:dc="urn:dc" xmlns:upnp="urn:upnp"><item id="1"><dc:title>${title}</dc:title><dc:creator>Test artist</dc:creator><upnp:class>object.item.audioItem.audioBroadcast</upnp:class>${art ? `<upnp:albumArtURI>${escapeXml(art)}</upnp:albumArtURI>` : ''}</item></DIDL-Lite>`;

function speakerMock(options = {}) {
  const rooms = seedRooms(), calls = [], states = new Map([['A', 'PLAYING'], ['C', 'STOPPED']]);
  const volumes = new Map(rooms.map(room => [room.id, options.initialVolumes?.[room.id] ?? 24]));
  let muted = false, uri = 'x-sonosapi-stream:s87683?sid=254&flags=8224', track = 1;
  const fetcher = async (url, init) => {
    const action = init.headers?.SOAPAction?.match(/#([^"#]+)"$/)?.[1];
    if (!action) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
    const args = Object.values(parseXml(init.body).Envelope.Body)[0];
    calls.push({ url, action, args });
    let result = {};
    const origin = new URL(url).origin;
    const room = rooms.find(room => room.origin === origin);
    if (action === 'GetZoneGroupState') result.ZoneGroupState = topologyXml(rooms);
    else if (action === 'GetTransportInfo') { result.CurrentTransportState = states.get(room.coordinator) || 'STOPPED'; result.CurrentTransportStatus = 'OK'; }
    else if (action === 'GetMediaInfo') { result.CurrentURI = options.tv ? 'x-sonos-htastream:A:spdif' : uri; result.CurrentURIMetaData = didl('Qmusic'); }
    else if (action === 'GetPositionInfo') { result.TrackMetaData = didl('Test track', options.art || '/getaa?s=1'); result.Track = track; }
    else if (action === 'GetCurrentTransportActions') result.Actions = 'Play,Pause,Next,Previous';
    else if (action === 'GetVolume') result.CurrentVolume = options.missingVolume ? '' : volumes.get(room.id);
    else if (action === 'GetMute') result.CurrentMute = muted ? 1 : 0;
    else if (action === 'SetVolume') volumes.set(room.id, Number(args.DesiredVolume));
    else if (action === 'SetMute') muted = args.DesiredMute === '1';
    else if (action === 'Play') states.set(room.coordinator, 'PLAYING');
    else if (action === 'Pause') states.set(room.coordinator, 'PAUSED_PLAYBACK');
    else if (action === 'SetAVTransportURI') { if (args.CurrentURI.startsWith('x-rincon:')) room.coordinator = args.CurrentURI.slice(9); else uri = args.CurrentURI; }
    else if (action === 'AddURIToQueue') result.FirstTrackNumberEnqueued = 42;
    else if (action === 'Seek') track = Number(args.Target);
    else if (action === 'DelegateGroupCoordinationTo') { const old = room.coordinator; for (const entry of rooms) if (entry.coordinator === old) entry.coordinator = args.NewCoordinator; }
    else if (action === 'BecomeCoordinatorOfStandaloneGroup') room.coordinator = room.id;
    else if (action === 'Browse') {
      result.NumberReturned = 1; result.TotalMatches = 1; result.UpdateID = '1';
      const metadata = options.queue ? didl().replace('audioBroadcast', 'musicTrack') : didl();
      result.Result = `<DIDL-Lite xmlns:dc="urn:dc" xmlns:r="urn:r"><item id="fav"><dc:title>Qmusic</dc:title><res>x-sonosapi-stream:s87683?sid=254&amp;flags=8224</res><r:resMD>${escapeXml(metadata)}</r:resMD></item></DIDL-Lite>`;
    }
    if (options.failWrite && ['SetVolume', 'Play', 'AddURIToQueue'].includes(action)) throw new Error('response lost');
    const fields = Object.entries(result).map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join('');
    return new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:sonos">${fields}</u:${action}Response></s:Body></s:Envelope>`);
  };
  return { fetcher, calls, rooms };
}
const sonosSettings = () => config({ SONOS_BOOTSTRAP_ADDRESS: origins[0] });
const writeActions = ['Play', 'Pause', 'Next', 'Previous', 'SetVolume', 'SetMute', 'SetAVTransportURI', 'AddURIToQueue', 'Seek', 'DelegateGroupCoordinationTo', 'BecomeCoordinatorOfStandaloneGroup'];

test('Sonos XML and origins reject entity documents and SSRF targets', () => {
  for (const address of ['http://127.0.0.1:1400', 'http://169.254.169.254:1400', 'https://192.168.1.10:1400', 'http://example.com:1400', 'http://192.168.1.10:8080']) assert.throws(() => speakerOrigin(address));
  assert.equal(speakerOrigin(`${origins[0]}/xml/device_description.xml`), origins[0]);
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY a "bomb">]><x>&a;</x>'));
  assert.throws(() => parseXml('<x><y></x>'));
});

test('Sonos discovery hides bonded speakers and scope reflects membership changes', () => {
  const rooms = seedRooms(); rooms.push({ id: 'H', name: 'Hidden', origin: origins[1], coordinator: 'A', hidden: true });
  const inventory = parseTopology(topologyXml(rooms)); assert.equal(inventory.rooms.length, 3);
  rooms[1].coordinator = 'B'; assert.notEqual(parseTopology(topologyXml(rooms)).scope, inventory.scope);
  assert.throws(() => parseTopology(topologyXml([{ ...rooms[0], coordinator: 'MISSING' }])));
});

test('Sonos selection, status and favorites are reads and never leak speaker URLs or metadata', async () => {
  const mock = speakerMock(); const sonos = createSonosService(sonosSettings(), mock.fetcher);
  const data = await sonos.get('B', true);
  assert.equal(data.player.roomId, 'B'); assert.equal(data.player.title, 'Test track'); assert.equal(data.player.volume, 24);
  assert.equal(data.favorites[0].title, 'Qmusic'); assert.ok(data.player.artwork.startsWith('/api/sonos/artwork/'));
  assert.equal(mock.calls.filter(call => writeActions.includes(call.action)).length, 0);
  assert.ok(!JSON.stringify(data).includes('192.168')); assert.ok(!JSON.stringify(data).includes('resMD'));
  const position = mock.calls.find(call => call.action === 'GetPositionInfo'); assert.ok(position.url.startsWith(origins[0]));
  const volume = mock.calls.find(call => call.action === 'GetVolume'); assert.ok(volume.url.startsWith(origins[1]));
});

test('volume and mute target the selected room, preserve grouping and never retry a write', async () => {
  const mock = speakerMock(); const sonos = createSonosService(sonosSettings(), mock.fetcher);
  const initial = await sonos.get('B');
  await sonos.command({ action: 'volume', roomId: 'B', scope: initial.scope, delta: 2 });
  await sonos.command({ action: 'mute', roomId: 'B', scope: initial.scope, mute: true });
  const writes = mock.calls.filter(call => writeActions.includes(call.action));
  assert.deepEqual(writes.map(call => call.action), ['SetVolume', 'SetMute']); assert.ok(writes.every(call => call.url.startsWith(origins[1])));
  assert.equal((await sonos.get('B')).player.volume, 26); assert.equal(mock.rooms[1].coordinator, 'A');
  const failed = speakerMock({ failWrite: true }); const other = createSonosService(sonosSettings(), failed.fetcher);
  const scope = (await other.get('B')).scope;
  await assert.rejects(other.command({ action: 'volume', roomId: 'B', scope, delta: 2 }));
  assert.equal(failed.calls.filter(call => call.action === 'SetVolume').length, 1);
});

test('changed group scope blocks playback and TV disables transport while preserving volume', async () => {
  const mock = speakerMock(); const sonos = createSonosService(sonosSettings(), mock.fetcher);
  const data = await sonos.get('B'); mock.rooms[1].coordinator = 'B';
  await assert.rejects(sonos.command({ action: 'pause', roomId: 'B', scope: data.scope }), error => error.code === 'roomChanged');
  assert.equal(mock.calls.filter(call => writeActions.includes(call.action)).length, 0);
  const tv = speakerMock({ tv: true }); const tvService = createSonosService(sonosSettings(), tv.fetcher); const state = await tvService.get('A');
  assert.equal(state.player.title, 'TV'); assert.equal(state.player.artist, ''); assert.equal(state.player.artwork, null);
  await assert.rejects(tvService.command({ action: 'pause', roomId: 'A', scope: state.scope }), error => error.code === 'actionUnavailable');
});

test('implicit main-room volume preserves offsets; explicit selection only changes one room', async () => {
  const mock = speakerMock({ initialVolumes: { A: 24, B: 16 } });
  const service = createSonosService(sonosSettings(), mock.fetcher);
  const initial = await service.get('A', false, true);
  assert.equal(initial.player.volumeValues.length, 2);
  await service.command({ action: 'volume', roomId: 'A', scope: initial.scope, delta: 2, combined: true });
  const writes = mock.calls.filter(call => call.action === 'SetVolume');
  assert.deepEqual(writes.map(call => Number(call.args.DesiredVolume)).sort((a,b) => a-b), [18, 26]);
  await service.command({ action: 'volume', roomId: 'B', scope: initial.scope, delta: -2, combined: false });
  assert.equal((await service.get('A')).player.volume, 26); assert.equal((await service.get('B')).player.volume, 16);
});

test('radio favorites preserve group/volume and queue favorites append without clearing', async () => {
  for (const queue of [false, true]) {
    const mock = speakerMock({ queue }); const service = createSonosService(sonosSettings(), mock.fetcher, Date.now, async () => {});
    const initial = await service.get('B', true);
    await service.command({ action: 'favorite', roomId: 'B', scope: initial.scope, favoriteId: 'fav' });
    const writes = mock.calls.filter(call => writeActions.includes(call.action));
    assert.equal(writes.at(-1).action, 'Play'); assert.ok(writes.every(call => call.url.startsWith(origins[0])));
    assert.ok(!writes.some(call => ['SetVolume', 'SetMute', 'DelegateGroupCoordinationTo', 'BecomeCoordinatorOfStandaloneGroup'].includes(call.action)));
    if (queue) { assert.equal(writes.filter(call => call.action === 'AddURIToQueue').length, 1); assert.ok(writes.some(call => call.action === 'Seek' && call.args.Target === '42')); }
    else assert.ok(!writes.some(call => call.action === 'AddURIToQueue'));
  }
});

test('compact player retains playing room and follows another coordinator after it stops', async () => {
  const mock = speakerMock(); const service = createSonosService(sonosSettings(), mock.fetcher);
  const first = await service.get(''); assert.equal(first.player.roomId, 'A');
  await service.command({ action: 'play', roomId: 'C', scope: first.scope });
  assert.equal((await service.get('')).player.roomId, 'A');
  await service.command({ action: 'pause', roomId: 'A', scope: first.scope });
  assert.equal((await service.get('')).player.roomId, 'C');
});

test('group planning promotes a follower and leaves unrelated followers with a coordinator', async () => {
  const rooms = [...seedRooms(), { id: 'D', name: 'Office', coordinator: 'C', origin: 'http://192.168.1.13:1400' }];
  const plan = planGroup(rooms, 'B', ['B', 'C']);
  assert.equal(plan.writes[0].action, 'DelegateGroupCoordinationTo'); assert.equal(plan.writes[0].args.NewCoordinator, 'B');
  assert.ok(plan.writes.some(call => call.action === 'DelegateGroupCoordinationTo' && call.args.NewCoordinator === 'D'));
  assert.deepEqual(Object.fromEntries(plan.expected), { A: 'A', B: 'B', C: 'B', D: 'D' });
  assert.throws(() => planGroup(rooms, 'B', ['C']));
  const mock = speakerMock(); const service = createSonosService(sonosSettings(), mock.fetcher, Date.now, async () => {});
  const initial = await service.get('B'); await service.command({ action: 'group', roomId: 'B', scope: initial.scope, members: ['B', 'C'] });
  assert.deepEqual(Object.fromEntries(mock.rooms.map(room => [room.id, room.coordinator])), { A: 'A', B: 'B', C: 'B' });
});

test('artwork uses opaque server keys and rejects external/private arbitrary image origins', async () => {
  for (const art of ['http://169.254.169.254/latest/meta-data', 'https://evil.example/art.jpg', '/unrelated-endpoint']) {
    const mock = speakerMock({ art }); const service = createSonosService(sonosSettings(), mock.fetcher);
    const data = await service.get('A'); assert.ok(data.player.artwork === '/stations/qmusic.jpg' || data.player.artwork === null);
    await assert.rejects(service.artwork('a'.repeat(64)), error => error.status === 404);
  }
  const mock = speakerMock(); const service = createSonosService(sonosSettings(), mock.fetcher);
  const data = await service.get('A'); const image = await service.artwork(data.player.artwork.split('/').at(-1));
  assert.equal(image.type, 'image/jpeg');
  assert.equal(stationArtwork('Radio 538', 'x-sonosapi-stream:s6712'), '/stations/radio-538.jpg');
});

test('source comparison accepts only the documented flag normalization', () => {
  assert.ok(sourceMatches('x-sonosapi-stream:s1?flags=32&sid=1', 'x-sonosapi-stream:s1?sid=1&flags=96'));
  assert.ok(!sourceMatches('x-sonosapi-stream:s1?flags=32&sid=1', 'x-sonosapi-stream:s1?sid=2&flags=96'));
  assert.ok(!sourceMatches('https://example.com/a', 'https://example.com/b'));
});

test('demo controls change only the in-memory simulated player and never contact a speaker', async () => {
  const service = createSonosService(config({ ENERGYDECK_WEB_DEMO: 'true' }), () => { throw new Error('must not fetch'); });
  const initial = await service.get();
  await service.command({ action: 'pause', roomId: initial.player.roomId, scope: initial.scope });
  assert.equal((await service.get()).player.state, 'PAUSED_PLAYBACK');
  await service.command({ action: 'volume', roomId: initial.player.roomId, scope: initial.scope, delta: -2 });
  assert.equal((await service.get()).player.volume, 22);
});

test('control APIs require session and matching Origin before invoking device services', async t => {
  let commands = 0;
  const settings = config({ ENERGYDECK_WEB_SECURE_COOKIE: 'false' });
  const server = createApp(settings, { sonos: { command: async () => { commands++; return { ok: true }; } }, extras: { charge: async () => { commands++; return { ok: true }; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, headers, body = {}) => fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/api/charge', { Origin: origin })).status, 401);
  const login = await post('/api/login', { Origin: origin }, { code: settings.accessCode }); const cookie = login.headers.get('set-cookie').split(';')[0];
  for (const path of ['/api/charge', '/api/sonos/command']) {
    assert.equal((await post(path, { Cookie: cookie })).status, 403);
    assert.equal((await post(path, { Cookie: cookie, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(path, { Cookie: cookie, Origin: origin })).status, 200);
  }
  assert.equal(commands, 2);
});
