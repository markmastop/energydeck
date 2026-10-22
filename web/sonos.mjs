import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AppError, boundedFetch } from './net.mjs';

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false });
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const value = raw => typeof raw === 'string' ? raw : raw?.['#text'] || '';
const hash = raw => createHash('sha256').update(raw).digest('hex');
const transportState = reply => value(reply.CurrentTransportStatus) === 'OK' && ['PLAYING', 'PAUSED_PLAYBACK', 'STOPPED', 'TRANSITIONING', 'NO_MEDIA_PRESENT'].includes(value(reply.CurrentTransportState)) ? value(reply.CurrentTransportState) : 'UNKNOWN';
function volumeRooms(rooms, selected, combined) {
  const main = /^(woonkamer|living(?: room)?|keuken|kitchen)$/i;
  if (!combined || !main.test(selected.name)) return [selected];
  const pair = rooms.filter(room => room.coordinator === selected.coordinator && main.test(room.name));
  return pair.length === 2 ? pair : [selected];
}
export const escapeXml = raw => String(raw).replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);
export function parseXml(raw) {
  // SOAP/DIDL need standard XML escapes, never document-defined or external entities.
  if (typeof raw !== 'string' || raw.length > 262144 || /<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) throw new AppError('invalidSonos');
  return parser.parse(raw);
}
export function speakerOrigin(raw) {
  try {
    const url = new URL(raw);
    const octets = url.hostname.split('.').map(Number);
    const privateAddress = isIP(url.hostname) === 4 && (octets[0] === 10 || octets[0] === 192 && octets[1] === 168 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
    if (!privateAddress || url.protocol !== 'http:' || url.port !== '1400' || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new AppError('invalidSpeaker', 400); }
}

export function parseTopology(raw) {
  const root = parseXml(raw);
  const groups = list(root.ZoneGroups?.ZoneGroup || root.ZoneGroupState?.ZoneGroups?.ZoneGroup);
  const rooms = [];
  const allIds = new Set();
  for (const group of groups) {
    const coordinator = group['@_Coordinator'];
    if (typeof coordinator !== 'string' || !/^[\w-]{1,128}$/.test(coordinator)) throw new AppError('invalidSonos');
    for (const member of list(group.ZoneGroupMember)) {
      if (typeof member['@_UUID'] !== 'string' || !/^[\w-]{1,128}$/.test(member['@_UUID']) || allIds.has(member['@_UUID'])) throw new AppError('invalidSonos');
      allIds.add(member['@_UUID']);
      if (member['@_Invisible'] === '1') continue;
      rooms.push({ id: member['@_UUID'], name: String(member['@_ZoneName'] || member['@_UUID']).slice(0, 128),
        coordinator, origin: speakerOrigin(member['@_Location']) });
    }
  }
  if (!rooms.length || rooms.length > 32 || rooms.some(room => !rooms.some(r => r.id === room.coordinator))) throw new AppError('invalidSonos');
  rooms.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en') || a.id.localeCompare(b.id));
  const scope = hash(JSON.stringify(rooms.map(r => [r.id, r.origin, r.coordinator])));
  return { rooms, scope };
}

export function planGroup(rooms, anchorId, selectedIds) {
  const anchor = rooms.find(room => room.id === anchorId);
  const choices = new Set(selectedIds);
  if (!anchor || choices.size !== selectedIds.length || !choices.has(anchorId) || [...choices].some(id => !rooms.some(r => r.id === id))) throw new AppError('invalidGroup', 400);
  const writes = [], leaders = new Map(rooms.map(room => [room.coordinator, room.coordinator]));
  const delegate = (id, next) => {
    const leader = rooms.find(room => room.id === id);
    writes.push({ origin: leader.origin, action: 'DelegateGroupCoordinationTo', args: { InstanceID: 0, NewCoordinator: next, RejoinGroup: 1, ClearSource: 0 } });
  };
  if (anchor.coordinator !== anchor.id) delegate(anchor.coordinator, anchor.id);
  leaders.set(anchor.coordinator, anchor.id);
  for (const [id] of leaders) if (id !== anchor.coordinator && choices.has(id)) {
    const remaining = rooms.find(room => room.coordinator === id && !choices.has(room.id));
    if (remaining) { delegate(id, remaining.id); leaders.set(id, remaining.id); }
  }
  for (const room of rooms) if (room.coordinator === anchor.coordinator && !choices.has(room.id))
    writes.push({ origin: room.origin, action: 'BecomeCoordinatorOfStandaloneGroup', args: { InstanceID: 0 } });
  // Followers move first; otherwise unselected followers could move with their old leader.
  for (const leader of [false, true]) for (const room of rooms) {
    if (room.id !== anchor.id && choices.has(room.id) && room.coordinator !== anchor.coordinator && (room.id === room.coordinator) === leader)
      writes.push({ origin: room.origin, action: 'SetAVTransportURI', args: { InstanceID: 0, CurrentURI: `x-rincon:${anchor.id}`, CurrentURIMetaData: '' } });
  }
  const expected = rooms.map(room => [room.id, choices.has(room.id) ? anchor.id : room.coordinator === anchor.coordinator ? room.id : leaders.get(room.coordinator)]);
  return { writes, expected };
}

export function createSonosService(config, fetcher = fetch, clock = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const seeds = (config.sonosSeeds || []).map(speakerOrigin);
  let topology = null, topologyAt = 0, favorites = [], favoritesAt = 0, favoritesScope = '', tail = Promise.resolve(), busy = false, autoRoom = '', scanCursor = 0, commandDeadline = 0;
  const snapshots = new Map(), pending = new Map(), artwork = new Map();
  const demoModel = demoSonos();
  const demoVolumes = new Map(demoModel.rooms.map(room => [room.id, 24]));
  const demoMutes = new Map(demoModel.rooms.map(room => [room.id, false]));
  function readDemo(id, combined = false) {
    const model = structuredClone(demoModel);
    const room = model.rooms.find(room => room.id === id) || model.rooms[0];
    model.scope = hash(JSON.stringify(model.rooms.map(room => [room.id, room.coordinator])));
    model.player = { ...model.player, roomId: room.id, name: room.name, group: model.rooms.filter(r => r.coordinator === room.coordinator).map(r => r.name).join(' + '),
      scope: model.scope, state: room.state, volume: demoVolumes.get(room.id), mute: demoMutes.get(room.id), updatedAt: clock() };
    model.player.volumeValues = volumeRooms(model.rooms, room, combined).map(item => ({ id: item.id, value: demoVolumes.get(item.id) }));
    return model;
  }
  async function commandDemo(body) {
    const model = readDemo(body?.roomId);
    const room = demoModel.rooms.find(room => room.id === body?.roomId);
    if (!room || !['play', 'pause', 'previous', 'next', 'volume', 'mute', 'favorite', 'group'].includes(body.action)) throw new AppError('invalidCommand', 400);
    if (body.scope !== model.scope) throw new AppError('roomChanged', 409);
    if (body.action === 'volume') {
      if (![2, -2].includes(body.delta)) throw new AppError('invalidCommand', 400);
      for (const target of volumeRooms(demoModel.rooms, room, body.combined)) demoVolumes.set(target.id, Math.max(0, Math.min(100, demoVolumes.get(target.id) + body.delta)));
    } else if (body.action === 'mute') {
      if (typeof body.mute !== 'boolean') throw new AppError('invalidCommand', 400);
      for (const target of volumeRooms(demoModel.rooms, room, body.combined)) demoMutes.set(target.id, body.mute);
    } else if (body.action === 'group') {
      if (!Array.isArray(body.members)) throw new AppError('invalidGroup', 400);
      const plan = planGroup(demoModel.rooms.map((room, i) => ({ ...room, origin: `http://192.168.1.${i + 1}:1400` })), room.id, body.members);
      for (const [id, coordinator] of plan.expected) demoModel.rooms.find(room => room.id === id).coordinator = coordinator;
    } else {
      if (body.action === 'favorite') {
        const favorite = demoModel.favorites.find(item => item.id === body.favoriteId);
        if (!favorite) throw new AppError('favoritesChanged', 409);
        Object.assign(demoModel.player, { title: favorite.title, artist: '', album: '', artwork: favorite.artwork });
      }
      if (['previous', 'next'].includes(body.action)) Object.assign(demoModel.player, { title: body.action === 'next' ? 'Everywhere' : 'Dreams', artist: 'Fleetwood Mac' });
      for (const entry of demoModel.rooms) if (entry.coordinator === room.coordinator) entry.state = body.action === 'pause' ? 'PAUSED_PLAYBACK' : 'PLAYING';
    }
    return { ok: true, demo: true };
  }
  const serial = fn => { const result = tail.then(fn); tail = result.catch(() => {}); return result; };
  async function soap(origin, service, action, args = {}, write = false) {
    const path = service === 'ZoneGroupTopology' ? '/ZoneGroupTopology/Control' : service === 'ContentDirectory' ? '/MediaServer/ContentDirectory/Control' : `/MediaRenderer/${service}/Control`;
    const content = Object.entries(args).map(([key, entry]) => `<${key}>${escapeXml(entry)}</${key}>`).join('');
    const envelope = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${service}:1">${content}</u:${action}></s:Body></s:Envelope>`;
    // SOAP uses POST for reads too; writes are issued once even on timeout or SOAP fault.
    const timeout = write ? write !== 'group' && ['SetAVTransportURI', 'AddURIToQueue'].includes(action) ? 30000 : 8000 : 2500;
    const remaining = commandDeadline ? commandDeadline - clock() : timeout;
    // Stop a slow multi-stage operation rather than sending delayed writes after the UI times out.
    if (remaining <= 0) throw new AppError('commandUnconfirmed', 409);
    const { body } = await boundedFetch(`${speakerOrigin(origin)}${path}`, { method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"urn:schemas-upnp-org:service:${service}:1#${action}"` },
      body: envelope, signal: AbortSignal.timeout(Math.min(timeout, remaining)) }, fetcher, 262144);
    const result = parseXml(body.toString())?.Envelope?.Body;
    if (!result || result.Fault || result[`${action}Response`] === undefined) throw new AppError('sonosFailed');
    return result[`${action}Response`] || {};
  }
  async function discover(force = false) {
    if (topology && !force && clock() - topologyAt < 10000) return topology;
    const origins = [...new Set([...seeds, ...(topology?.rooms.map(room => room.origin) || [])])].slice(0, 4);
    for (const origin of origins) {
      try {
        const reply = await soap(origin, 'ZoneGroupTopology', 'GetZoneGroupState');
        const next = parseTopology(value(reply.ZoneGroupState));
        if (topology?.scope !== next.scope) { snapshots.clear(); favoritesAt = 0; }
        topology = next; topologyAt = clock(); return topology;
      } catch { /* A second configured seed can still discover the household. */ }
    }
    topology = null; snapshots.clear(); favorites = []; favoritesAt = 0;
    throw new AppError(seeds.length ? 'sonosOffline' : 'sonosUnconfigured', 503);
  }
  function target(inventory, id) {
    const room = inventory.rooms.find(item => item.id === id) || (!id ? inventory.rooms[0] : null);
    if (!room) throw new AppError('roomChanged', 409);
    return { room, coordinator: inventory.rooms.find(item => item.id === room.coordinator) };
  }
  function rememberArt(raw, origin) {
    if (!raw || raw.length > 8192) return null;
    try {
      const url = new URL(raw, origin);
      const local = !url.username && !url.password && topology?.rooms.some(room => room.origin === url.origin) && url.pathname === '/getaa';
      const remote = url.protocol === 'https:' && !url.username && !url.password &&
        /^(i\.scdn\.co|image-cdn-[a-z]+\.spotifycdn\.com|resources\.tidal\.com|[a-z0-9-]+\.mzstatic\.com|m\.media-amazon\.com|cdn-profiles\.tunein\.com|cdn-radiotime-logos\.tunein\.com)$/.test(url.hostname);
      if (!local && !remote) return null;
      const key = hash(url.href);
      if (!artwork.has(key) && artwork.size >= 128) artwork.delete(artwork.keys().next().value);
      const previous = artwork.get(key);
      artwork.set(key, { url: url.href, until: clock() + 300000, body: previous?.body, type: previous?.type });
      return `/api/sonos/artwork/${key}`;
    } catch { return null; }
  }
  async function snapshot(inventory, id) {
    const { room, coordinator } = target(inventory, id);
    const transport = await soap(coordinator.origin, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 });
    const media = await soap(coordinator.origin, 'AVTransport', 'GetMediaInfo', { InstanceID: 0 });
    const position = await soap(coordinator.origin, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 });
    const actions = await soap(coordinator.origin, 'AVTransport', 'GetCurrentTransportActions', { InstanceID: 0 });
    const volume = await soap(room.origin, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' });
    const mute = await soap(room.origin, 'RenderingControl', 'GetMute', { InstanceID: 0, Channel: 'Master' });
    let item = {}, source = {};
    try { item = parseXml(value(position.TrackMetaData))?.['DIDL-Lite']?.item || {}; } catch { /* Empty metadata is normal for TV/idle. */ }
    try { source = parseXml(value(media.CurrentURIMetaData))?.['DIDL-Lite']?.item || {}; } catch { /* Optional station title. */ }
    const tv = value(media.CurrentURI).startsWith('x-sonos-htastream:');
    const healthy = value(transport.CurrentTransportStatus) === 'OK';
    const number = Number(value(volume.CurrentVolume));
    // Real Sonos replies use comma + space; compare complete trimmed action
    // names just like the ESP, without accepting partial names such as NextTrack.
    const available = value(actions.Actions).split(',').map(action => action.trim()).filter(Boolean);
    const result = { roomId: room.id, name: room.name, group: inventory.rooms.filter(r => r.coordinator === room.coordinator).map(r => r.name).join(' + '),
      scope: inventory.scope, state: transportState(transport), tv,
      title: tv ? 'TV' : (value(item.title) || value(source.title)).slice(0, 512), artist: tv ? '' : (value(item.creator) || value(item.artist)).slice(0, 256),
      album: tv ? '' : value(item.album).slice(0, 256), artwork: tv ? null : rememberArt(value(item.albumArtURI) || value(source.albumArtURI), coordinator.origin) || stationArtwork(value(source.title), value(media.CurrentURI)),
      volume: /^\d+$/.test(value(volume.CurrentVolume)) && Number.isInteger(number) && number >= 0 && number <= 100 ? number : null,
      mute: ['0', '1'].includes(value(mute.CurrentMute)) ? value(mute.CurrentMute) === '1' : null,
      actions: healthy ? available : [], updatedAt: clock() };
    snapshots.set(room.id, result);
    return result;
  }
  function publicRooms(inventory, states = {}) {
    return inventory.rooms.map(({ id, name, coordinator }) => ({ id, name, coordinator, state: states[coordinator] || snapshots.get(id)?.state || 'UNKNOWN' }))
      .sort((a, b) => (b.state === 'PLAYING') - (a.state === 'PLAYING') || a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
  }
  async function browse(inventory, roomId, force = false) {
    const { coordinator } = target(inventory, roomId);
    if (!force && favoritesAt && clock() - favoritesAt < 300000 && favoritesScope === coordinator.id) return favorites;
    const next = [], ids = new Set();
    let offset = 0, version;
    for (let page = 0; page < 13; page++) {
      if (busy && !force) throw new AppError('commandBusy', 409);
      const reply = await soap(coordinator.origin, 'ContentDirectory', 'Browse', { ObjectID: 'FV:2', BrowseFlag: 'BrowseDirectChildren', Filter: '*', StartingIndex: offset, RequestedCount: 8, SortCriteria: '' });
      const returned = Number(value(reply.NumberReturned)), total = Number(value(reply.TotalMatches)), update = value(reply.UpdateID);
      if (!/^\d+$/.test(value(reply.TotalMatches)) || !/^\d+$/.test(value(reply.NumberReturned)) || !update || !Number.isInteger(total) || total > 100 || total < 0 || !Number.isInteger(returned) || returned < 0 || returned > 8 || offset + returned > total || offset && update !== version || !returned && offset < total) throw new AppError('favoritesChanged', 409);
      version = update;
      const root = returned ? parseXml(value(reply.Result))?.['DIDL-Lite'] : {};
      const entries = [...list(root?.item), ...list(root?.container)];
      if (entries.length !== returned) throw new AppError('invalidSonos');
      for (const entry of entries) {
        const id = entry['@_id'], uri = value(entry.res), metadata = value(entry.resMD), title = value(entry.title);
        if (!uri || !metadata || !title || !id) continue;
        const meta = parseXml(metadata)?.['DIDL-Lite']?.item || parseXml(metadata)?.['DIDL-Lite']?.container;
        const kind = value(meta?.class);
        if (!/audioBroadcast|playlistContainer|musicAlbum|musicTrack/.test(kind)) continue;
        if (ids.has(id) || uri.length > 8192 || metadata.length > 8192 || title.length > 512) throw new AppError('invalidSonos');
        ids.add(id);
        next.push({ id, uri, metadata, title, radio: kind.includes('audioBroadcast'), artwork: rememberArt(value(entry.albumArtURI) || value(meta?.albumArtURI), coordinator.origin) || stationArtwork(title, uri) });
      }
      offset += returned;
      if (offset === total) { favorites = next; favoritesAt = clock(); favoritesScope = coordinator.id; return favorites; }
    }
    throw new AppError('favoritesChanged', 409);
  }
  const publicFavorites = entries => entries.map(({ id, title, radio, artwork }) => ({ id, title, radio, artwork }));
  const instance = { InstanceID: 0 };
  async function ready(origin, predicate) {
    for (let i = 0; i < 10; i++) {
      if (await predicate()) return;
      await pause(200);
    }
    throw new AppError('commandUnconfirmed', 409);
  }
  async function favorite(inventory, roomId, id) {
    const { coordinator } = target(inventory, roomId);
    const entry = (await browse(inventory, roomId, true)).find(item => item.id === id);
    if (!entry) throw new AppError('favoritesChanged', 409);
    // A paged Browse can take time. Recheck the displayed group after browsing, before writes.
    if ((await discover(true)).scope !== inventory.scope) throw new AppError('roomChanged', 409);
    if (entry.radio) {
      const current = await soap(coordinator.origin, 'AVTransport', 'GetMediaInfo', instance);
      if (!sourceMatches(entry.uri, value(current.CurrentURI))) await soap(coordinator.origin, 'AVTransport', 'SetAVTransportURI', { ...instance, CurrentURI: entry.uri, CurrentURIMetaData: entry.metadata }, true);
    } else {
      const reply = await soap(coordinator.origin, 'AVTransport', 'AddURIToQueue', { ...instance, EnqueuedURI: entry.uri, EnqueuedURIMetaData: entry.metadata, DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 }, true);
      const track = Number(value(reply.FirstTrackNumberEnqueued));
      if (!Number.isInteger(track) || track < 1) throw new AppError('commandUnconfirmed', 409);
      const queue = `x-rincon-queue:${coordinator.id}#0`;
      await soap(coordinator.origin, 'AVTransport', 'SetAVTransportURI', { ...instance, CurrentURI: queue, CurrentURIMetaData: '' }, true);
      await ready(coordinator.origin, async () => value((await soap(coordinator.origin, 'AVTransport', 'GetMediaInfo', instance)).CurrentURI) === queue);
      await soap(coordinator.origin, 'AVTransport', 'Seek', { ...instance, Unit: 'TRACK_NR', Target: track }, true);
      await ready(coordinator.origin, async () => Number(value((await soap(coordinator.origin, 'AVTransport', 'GetPositionInfo', instance)).Track)) === track);
    }
    const expected = entry.radio ? entry.uri : `x-rincon-queue:${coordinator.id}#0`;
    await ready(coordinator.origin, async () => {
      const media = await soap(coordinator.origin, 'AVTransport', 'GetMediaInfo', instance);
      const state = await soap(coordinator.origin, 'AVTransport', 'GetTransportInfo', instance);
      return sourceMatches(expected, value(media.CurrentURI)) && transportState(state) !== 'UNKNOWN' && transportState(state) !== 'TRANSITIONING';
    });
    await soap(coordinator.origin, 'AVTransport', 'Play', { ...instance, Speed: 1 }, true);
    await ready(coordinator.origin, async () => {
      const media = await soap(coordinator.origin, 'AVTransport', 'GetMediaInfo', instance);
      const state = await soap(coordinator.origin, 'AVTransport', 'GetTransportInfo', instance);
      return sourceMatches(expected, value(media.CurrentURI)) && transportState(state) === 'PLAYING';
    });
  }
  async function command(body) {
    if (!body || !['play', 'pause', 'previous', 'next', 'volume', 'mute', 'favorite', 'group'].includes(body.action) || typeof body.roomId !== 'string' || typeof body.scope !== 'string') throw new AppError('invalidCommand', 400);
    if (busy) throw new AppError('commandBusy', 409);
    busy = true;
    try {
      return await serial(async () => {
        commandDeadline = clock() + 120000;
        const inventory = await discover(true);
        if (inventory.scope !== body.scope) throw new AppError('roomChanged', 409);
        const { room, coordinator } = target(inventory, body.roomId);
        try {
          if (body.action === 'group') {
            if (!Array.isArray(body.members) || body.members.length > 32) throw new AppError('invalidGroup', 400);
            const plan = planGroup(inventory.rooms, room.id, body.members);
            for (const write of plan.writes) await soap(write.origin, 'AVTransport', write.action, write.args, 'group');
            await ready(room.origin, async () => {
              const actual = await discover(true);
              return actual.rooms.length === plan.expected.length && plan.expected.every(([id, leader]) => actual.rooms.find(r => r.id === id)?.coordinator === leader);
            });
          } else if (body.action === 'favorite') {
            if (typeof body.favoriteId !== 'string') throw new AppError('invalidCommand', 400);
            await favorite(inventory, room.id, body.favoriteId);
          } else if (body.action === 'volume' || body.action === 'mute') {
            const args = { ...instance, Channel: 'Master' };
            if (body.combined !== undefined && typeof body.combined !== 'boolean') throw new AppError('invalidCommand', 400);
            const targets = volumeRooms(inventory.rooms, room, body.combined);
            if (body.action === 'volume') {
              if (![2, -2].includes(body.delta)) throw new AppError('invalidCommand', 400);
              const planned = [];
              for (const selected of targets) {
                const returned = value((await soap(selected.origin, 'RenderingControl', 'GetVolume', args)).CurrentVolume);
                const raw = Number(returned);
                if (!/^\d+$/.test(returned) || !Number.isInteger(raw) || raw < 0 || raw > 100) throw new AppError('sonosFailed');
                planned.push({ origin: selected.origin, volume: Math.max(0, Math.min(100, raw + body.delta)) });
              }
              for (const selected of planned) await soap(selected.origin, 'RenderingControl', 'SetVolume', { ...args, DesiredVolume: selected.volume }, true);
            } else {
              if (typeof body.mute !== 'boolean') throw new AppError('invalidCommand', 400);
              for (const selected of targets) await soap(selected.origin, 'RenderingControl', 'SetMute', { ...args, DesiredMute: Number(body.mute) }, true);
            }
          } else {
            const current = await snapshot(inventory, room.id);
            const action = { play: 'Play', pause: 'Pause', previous: 'Previous', next: 'Next' }[body.action];
            if (current.tv || !current.actions.includes(action)) throw new AppError('actionUnavailable', 409);
            await soap(coordinator.origin, 'AVTransport', action, { ...instance, ...(body.action === 'play' ? { Speed: 1 } : {}) }, true);
          }
          return { ok: true };
        } finally { snapshots.clear(); topologyAt = 0; }
      });
    } finally { busy = false; commandDeadline = 0; }
  }
  async function get(roomId = '', withFavorites = false, combined = false) {
    if (roomId.length > 128) throw new AppError('invalidCommand', 400);
    const key = `${roomId}:${withFavorites}:${combined}`;
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 32) throw new AppError('commandBusy', 409);
    const operation = serial(async () => {
      // Skip queued background reads when a click is waiting behind the active read.
      if (busy) throw new AppError('commandBusy', 409);
      const inventory = await discover();
      const preferred = inventory.rooms.find(room => /^(woonkamer|living(?: room)?)$/i.test(room.name));
      let chosen = target(inventory, roomId || (inventory.rooms.some(room => room.id === autoRoom) ? autoRoom : preferred?.id || '')).room;
      const existing = snapshots.get(chosen.id);
      let player = existing && clock() - existing.updatedAt < 10000 ? existing : await snapshot(inventory, chosen.id);
      const states = { [chosen.coordinator]: player.state };
      // Bound all-room activity scans; selecting a room always reads that room itself.
      const deadline = clock() + 4000;
      const coordinators = [...new Set(inventory.rooms.map(room => room.coordinator))];
      const ordered = [...coordinators.slice(scanCursor % coordinators.length), ...coordinators.slice(0, scanCursor % coordinators.length)];
      scanCursor++;
      for (const coordinator of ordered) {
        if (clock() > deadline || busy) break;
        if (states[coordinator]) continue;
        try { states[coordinator] = transportState(await soap(target(inventory, coordinator).room.origin, 'AVTransport', 'GetTransportInfo', instance)); } catch { states[coordinator] = 'UNKNOWN'; }
      }
      if (!roomId && player.state !== 'PLAYING') {
        const playing = inventory.rooms.find(room => states[room.coordinator] === 'PLAYING');
        if (playing) { chosen = playing; player = await snapshot(inventory, chosen.id); }
      }
      if (!roomId) autoRoom = chosen.id;
      player = { ...player, volumeValues: [] };
      for (const selected of volumeRooms(inventory.rooms, chosen, combined)) {
        const raw = selected.id === chosen.id ? String(player.volume ?? '') : value((await soap(selected.origin, 'RenderingControl', 'GetVolume', { ...instance, Channel: 'Master' })).CurrentVolume);
        player.volumeValues.push({ id: selected.id, value: /^\d+$/.test(raw) && Number(raw) <= 100 ? Number(raw) : null });
      }
      let entries = [];
      if (withFavorites) { try { entries = publicFavorites(await browse(inventory, chosen.id)); } catch { favoritesAt = 0; } }
      return { player, rooms: publicRooms(inventory, states), favorites: entries, scope: inventory.scope, busy, demo: false };
    }).finally(() => pending.delete(key));
    pending.set(key, operation); return operation;
  }
  return {
    get: config.demo ? async (roomId, _, combined) => readDemo(roomId, combined) : get,
    command: config.demo ? commandDemo : command,
    async artwork(key) {
      const entry = artwork.get(key);
      if (!entry || entry.until < clock()) throw new AppError('notFound', 404);
      if (!entry.body) {
        const result = await boundedFetch(entry.url, {}, fetcher, 2 * 1024 * 1024);
        if (!/^image\/(jpeg|png|webp)(?:;|$)/i.test(result.type)) throw new AppError('invalidArtwork');
        entry.body = result.body; entry.type = result.type;
        // Bound decoded response buffers independently of the small URL registry.
        let bytes = [...artwork.values()].reduce((sum, item) => sum + (item.body?.length || 0), 0);
        for (const item of artwork.values()) {
          if (bytes <= 6 * 1024 * 1024) break;
          if (item !== entry && item.body) { bytes -= item.body.length; delete item.body; }
        }
      }
      return { body: entry.body, type: entry.type };
    },
  };
}

export function stationArtwork(title, uri = '') {
  const stations = [
    ['qmusic', 'Qmusic', 's87683'], ['npo-radio-2', 'NPO Radio 2', 's9483'], ['npo-radio-5', 'NPO Radio 5', 's25544'],
    ['npo-radio-1', 'NPO Radio 1', 's17523'], ['joe', 'JOE Nederland', 's307829'], ['sky-radio', 'Sky Radio', 's9067'],
    ['radio-538', 'Radio 538', 's6712'], ['radionl', 'RadioNL', 's106736'], ['radio-10', 'Radio 10', 's16793'],
    ['radio-veronica', 'Radio Veronica', 's6717'], ['100-nl', '100% NL', 's76590'],
  ];
  const matching = stations.find(([key, name, id]) => String(title).toLowerCase() === name.toLowerCase() || String(title).toLowerCase() === key || new RegExp(`\\b${id}\\b`).test(uri));
  return matching ? `/stations/${matching[0]}.jpg` : null;
}

export function sourceMatches(expected, actual) {
  if (expected === actual) return true;
  if (!expected.startsWith('x-sonosapi-stream:') || !actual.startsWith('x-sonosapi-stream:')) return false;
  try {
    const normalize = uri => {
      const url = new URL(uri.replace(/%[a-f\d]{2}/gi, text => text.toUpperCase()));
      const flags = url.searchParams.get('flags');
      if (flags !== null) { if (!/^\d+$/.test(flags)) return ''; url.searchParams.set('flags', String(Number(flags) & ~64)); }
      url.searchParams.sort(); return url.href;
    };
    return !!normalize(expected) && normalize(expected) === normalize(actual);
  } catch { return false; }
}

function demoSonos(id = 'RINCON_LIVING') {
  const rooms = [{ id: 'RINCON_LIVING', name: 'Woonkamer', coordinator: 'RINCON_LIVING', state: 'PLAYING' },
    { id: 'RINCON_KITCHEN', name: 'Keuken', coordinator: 'RINCON_LIVING', state: 'PLAYING' },
    { id: 'RINCON_BEDROOM', name: 'Slaapkamer', coordinator: 'RINCON_BEDROOM', state: 'STOPPED' }];
  const room = rooms.find(r => r.id === id) || rooms[0];
  return { player: { roomId: room.id, name: room.name, group: rooms.filter(r => r.coordinator === room.coordinator).map(r => r.name).join(' + '),
    scope: 'demo', state: room.state, tv: false, title: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours', artwork: '/stations/joe.jpg',
    volume: 24, mute: false, actions: ['Play', 'Pause', 'Previous', 'Next'], updatedAt: Date.now() }, rooms, scope: 'demo', busy: false, demo: true,
    favorites: [['joe', 'Joe'], ['qmusic', 'Qmusic'], ['npo-radio-2', 'NPO Radio 2'], ['sky-radio', 'Sky Radio'], ['radio-538', 'Radio 538'], ['npo-radio-1', 'NPO Radio 1']]
      .map(([id, title]) => ({ id, title, radio: true, artwork: `/stations/${id}.jpg` })) };
}
