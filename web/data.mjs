import { priceDayBounds } from './public/charts.js';
import { batteryPlan } from './public/battery-plan.js';

// All Homey polling is server-side, read-only, and restricted to configured IDs.
export function configuration(env = process.env) {
  const number = (key, fallback) => {
    const value = env[key]?.trim() ? Number(env[key]) : fallback;
    if (!Number.isFinite(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const accessCode = env.ENERGYDECK_WEB_ACCESS_CODE || '';
  if (accessCode.length !== 6 || !/^[0-9]{6}$/.test(accessCode)) {
    throw new Error('ENERGYDECK_WEB_ACCESS_CODE must contain exactly 6 digits');
  }
  const address = (env.HOMEY_ADDRESS || '').trim().replace(/\/$/, '');
  if (address) {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/') throw new Error('Invalid HOMEY_ADDRESS');
  }
  const origin = env.ENERGYDECK_WEB_ORIGIN || '';
  if (origin && new URL(origin).origin !== origin) throw new Error('Invalid ENERGYDECK_WEB_ORIGIN');
  const secureCookie = env.ENERGYDECK_WEB_SECURE_COOKIE !== 'false';
  if (origin && new URL(origin).protocol === 'https:' && !secureCookie) {
    throw new Error('HTTPS requires ENERGYDECK_WEB_SECURE_COOKIE=true');
  }
  return {
    accessCode, address, origin, secureCookie,
    token: env.HOMEY_TOKEN || '',
    demo: env.ENERGYDECK_WEB_DEMO === 'true',
    demoState: { charging: false },
    chargeFlow: env.HOMEY_CHARGE_FLOW_ID?.trim() || '',
    controller: env.HOMEY_THERMOSTAT_DEVICE_ID?.trim() || '',
    latitude: env.ENERGYDECK_LATITUDE?.trim() ? number('ENERGYDECK_LATITUDE', null) : null,
    longitude: env.ENERGYDECK_LONGITUDE?.trim() ? number('ENERGYDECK_LONGITUDE', null) : null,
    sonosSeeds: [env.SONOS_BOOTSTRAP_ADDRESS, env.SONOS_BOOTSTRAP_FALLBACK_ADDRESS].map(s => s?.trim()).filter(Boolean),
    tax: number('ENERGYDECK_ENERGY_TAX_EX_VAT_CT', 9.161),
    vat: number('ENERGYDECK_VAT_PERCENT', 21),
    fee: number('ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT', 2),
    devices: Object.fromEntries([
      ['grid', 'HOMEY_HOMEWIZARD_DEVICE_ID'], ['electricity', 'HOMEY_ELECTRICITY_SUMMARY_DEVICE_ID'],
      ['solar', 'HOMEY_SOLAR_DEVICE_ID'], ['solarDay', 'HOMEY_SOLAR_SUMMARY_DEVICE_ID'],
      ['battery', 'HOMEY_SESSY_DEVICE_ID'], ['charger', 'HOMEY_CHARGER_DEVICE_ID'],
      ['gas', 'HOMEY_GAS_SUMMARY_DEVICE_ID'],
    ].map(([name, key]) => [name, env[key]?.trim() || ''])),
    prices: env.HOMEY_PRICES_VARIABLE_ID?.trim() || '',
    batteryPlan: env.HOMEY_BATTERY_PLAN_VARIABLE_ID?.trim() || '',
    rooms: Array.from({ length: 9 }, (_, i) => ({
      id: env[`HOMEY_ROOM_THERMOSTAT_${i + 1}_ID`]?.trim() || '',
      name: env[`HOMEY_ROOM_THERMOSTAT_${i + 1}_NAME`] || '',
    })).filter(room => room.id && room.id !== 'none'),
  };
}

export function localDay(now = new Date(), offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = key => parts.find(p => p.type === key).value;
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function priceSource(day, bridge) {
  // Older bridges store provenance by date in sources instead of on each day.
  // An explicit day source remains authoritative, including unknown/unavailable.
  const source = Object.hasOwn(day, 'source') ? day.source : bridge?.sources?.[day.date];
  if (typeof source !== 'string') return 'unknown';
  if (source === 'homey' || source.startsWith('Homey')) return 'homey';
  if (source === 'epexprijzen' || source.startsWith('EpexPrijzen')) return 'epexprijzen';
  return 'unknown';
}

export function priceDay(bridge, date, config) {
  const day = [bridge?.today, bridge?.tomorrow].find(item => item?.date === date);
  const bounds = priceDayBounds(date);
  // A full calendar day includes every real quarter, including the repeated hour.
  if (!Array.isArray(day?.values) || day.values.length !== bounds.count ||
      !day.values.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const values = day.values.map(v => (v * 100 + config.tax) * (1 + config.vat / 100) + config.fee);
  let cheapest = 0;
  for (let i = 1; i <= values.length - 12; i++) {
    if (values.slice(i, i + 12).reduce((a, b) => a + b, 0) <
        values.slice(cheapest, cheapest + 12).reduce((a, b) => a + b, 0)) cheapest = i;
  }
  return {
    date, values, start: bounds.start, end: bounds.end, source: priceSource(day, bridge),
    cached: bridge.cachedDays?.includes(date) === true,
    fetchedAt: typeof bridge.fetchedAt?.[date] === 'string' ? bridge.fetchedAt[date] : null,
    minimum: Math.min(...values), maximum: Math.max(...values),
    average: values.reduce((a, b) => a + b, 0) / values.length, cheapest,
  };
}

const cap = (device, name) => device?.available === false ? null : device?.capabilitiesObj?.[name]?.value;
const metric = (device, name) => {
  const value = cap(device, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const ranged = (value, low, high) => value !== null && value >= low && value <= high ? value : null;
const bool = (device, name) => typeof cap(device, name) === 'boolean' ? cap(device, name) : null;

export function chargerState(device) {
  const power = metric(device, 'measure_power'), reported = bool(device, 'is_charging');
  const status = cap(device, 'status');
  return { power, connected: bool(device, 'is_connected'), fault: bool(device, 'alarm_device'),
    // Match the ESP: >50 W proves charging even when the charger flag lags behind.
    charging: reported === null || power === null ? null : reported || power > 50,
    complete: typeof status === 'string' && /finished|complete/.test(status) };
}

export function normalize(devices, rooms, bridge, config, now = new Date(), plan = null) {
  const [grid, electricity, solar, solarDay, battery, charger, gas] =
    ['grid', 'electricity', 'solar', 'solarDay', 'battery', 'charger', 'gas'].map(key => devices[key]);
  return {
    grid: { power: metric(grid, 'measure_power'), today: metric(electricity, 'meter_kwh_this_day'),
      yesterday: metric(electricity, 'meter_kwh_last_day'), month: metric(electricity, 'meter_kwh_this_month'), year: metric(electricity, 'meter_kwh_this_year'), peak: metric(electricity, 'measure_watt_max') },
    solar: { power: metric(solar, 'measure_power'), today: metric(solarDay, 'meter_kwh_this_day'),
      yesterday: metric(solarDay, 'meter_kwh_last_day'), month: metric(solarDay, 'meter_kwh_this_month'), year: metric(solarDay, 'meter_kwh_this_year'), peak: metric(solarDay, 'measure_watt_max') },
    battery: {
      percentage: ranged(metric(battery, 'measure_battery'), 0, 100),
      // Sessy uses negative watts for charging and positive watts for discharge.
      power: metric(battery, 'measure_power.battery') ?? metric(battery, 'measure_power'),
      plan: batteryPlan(plan, now),
    },
    charger: { ...chargerState(charger), canStart: !!config.chargeFlow && config.chargeFlow !== 'none' },
    gas: { today: metric(gas, 'meter_m3_this_day'), rate: metric(grid, 'measure_gas'),
      yesterday: metric(gas, 'meter_m3_last_day'), month: metric(gas, 'meter_m3_this_month'), year: metric(gas, 'meter_m3_this_year') },
    climate: climateState(devices.controller, rooms),
    rooms: rooms.map(({ device, name }, i) => {
      // Keep the same Evohome-only source restriction as the physical display.
      const room = device?.driverId === 'homey:app:com.honeywell:zone' ? device : null;
      return { name: name || device?.name || `Zone ${i + 1}`,
        temperature: ranged(metric(room, 'measure_temperature'), -20, 60),
        target: ranged(metric(room, 'target_temperature'), 5, 35) };
    }),
    prices: { today: priceDay(bridge, localDay(now), config), tomorrow: priceDay(bridge, localDay(now, 1), config) },
  };
}

export function createDataService(config, fetcher = fetch, clock = () => new Date()) {
  let cached, expires = 0, pending, revision = 0;
  async function request(path) {
    const response = await fetcher(`${config.address}${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Homey request failed');
    // Bound responses before parsing so unexpected upstream data cannot fill memory.
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('Homey response too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  async function refresh() {
    const now = clock();
    if (config.demo) return demoData(config, now);
    const errors = [];
    const devices = {};
    const rooms = config.rooms.map(room => ({ name: room.name, device: null }));
    let bridge = null;
    let plan = null;
    const jobs = [];
    const queue = (name, path, apply) => jobs.push(async () => {
      try { apply(await request(path)); } catch { errors.push(name); }
    });
    if (config.address && config.token) {
      for (const [key, id] of Object.entries(config.devices)) {
        if (id && id !== 'none') queue(key, `/api/manager/devices/device/${encodeURIComponent(id)}`, d => { devices[key] = d; });
      }
      config.rooms.forEach((room, i) => queue('climate', `/api/manager/devices/device/${encodeURIComponent(room.id)}`, d => { rooms[i].device = d; }));
      if (config.controller && config.controller !== 'none') queue('climate', `/api/manager/devices/device/${encodeURIComponent(config.controller)}`, d => { devices.controller = d; });
      if (config.prices && config.prices !== 'none') queue('prices', `/api/manager/logic/variable/${encodeURIComponent(config.prices)}`, d => {
        bridge = JSON.parse(d.value);
      });
      if (config.batteryPlan && config.batteryPlan !== 'none') queue('batteryPlan', `/api/manager/logic/variable/${encodeURIComponent(config.batteryPlan)}`, d => {
        plan = d.value;
      });
    }
    const configured = jobs.length > 0;
    // Three workers cap load on Homey, regardless of how many phones are open.
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => {
      while (jobs.length) await jobs.shift()();
    }));
    return { ...normalize(devices, rooms, bridge, config, now, plan), demo: false,
      status: !configured ? 'unconfigured' : errors.length ? 'partial' : 'online',
      errors: [...new Set(errors)], updatedAt: now.toISOString(), day: localDay(now) };
  }
  return {
    invalidate() { expires = 0; revision++; },
    async get() {
      const now = clock();
      if (cached && now.getTime() < expires && cached.day === localDay(now)) return cached;
      const version = revision;
      if (!pending) pending = refresh().then(value => {
        // An event received during a read must not be hidden by a fresh cache TTL.
        cached = value; expires = version === revision ? clock().getTime() + 15000 : 0; return value;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}

export function climateState(controller, rooms) {
  const mode = controller?.driverId === 'homey:app:com.honeywell:thermostat' ? cap(controller, 'honeywell_thermostat_mode') : null;
  if (mode === 'HeatingOff') return { mode, demand: 'off' };
  if (!['Auto', 'Away', 'AutoWithEco', 'Custom', 'DayOff'].includes(mode)) return { mode: null, demand: 'unknown' };
  const known = rooms.map(({ device }) => device?.driverId === 'homey:app:com.honeywell:zone' ?
    [ranged(metric(device, 'measure_temperature'), -20, 60), ranged(metric(device, 'target_temperature'), 5, 35)] : [null, null]);
  const demand = known.some(([measured, target]) => measured !== null && target !== null && target - measured > .05);
  return { mode, demand: demand ? 'demand' : known.length && known.every(values => values.every(v => v !== null)) ? 'idle' : 'unknown' };
}

function demoData(config, now) {
  const device = values => ({ capabilitiesObj: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) });
  const day = offset => ({ date: localDay(now, offset), source: 'homey',
    values: Array.from({ length: priceDayBounds(localDay(now, offset)).count }, (_, i) => .065 + .045 * Math.sin((i - 22) / 12) + .018 * Math.cos(i / 5)) });
  const rooms = [['Living room', 20.8, 21], ['Kitchen', 20.2, 20], ['Bedroom', 18.4, 18], ['Office', 19.6, 20], ['Bathroom', 21, 21], ['Hall', 18.8, 18], ['Attic', 17.5, 17], ['Guest room', 18, 18], ['Dining room', 20.1, 20]].map(([name, temperature, target]) => ({ name,
    device: { ...device({ measure_temperature: temperature, target_temperature: target }), driverId: 'homey:app:com.honeywell:zone' } }));
  return { ...normalize({ grid: device({ measure_power: -940, measure_gas: .12 }),
    electricity: device({ meter_kwh_this_day: 8.4, meter_kwh_this_month: 186.2, meter_kwh_this_year: 2480.6, measure_watt_max: 6320 }), solar: device({ measure_power: 2460 }),
    solarDay: device({ meter_kwh_this_day: 14.2, meter_kwh_this_month: 238.4, meter_kwh_this_year: 3124.8, measure_watt_max: 4210 }), battery: device({ measure_battery: 74, 'measure_power.battery': -860 }),
    charger: device({ measure_power: config.demoState?.charging ? 7300 : 0, is_connected: true, is_charging: config.demoState?.charging === true, alarm_device: false }),
    gas: device({ meter_m3_this_day: .83, meter_m3_last_day: 1.2, meter_m3_this_month: 24.8, meter_m3_this_year: 382.6 }),
    controller: { ...device({ honeywell_thermostat_mode: 'Auto' }), driverId: 'homey:app:com.honeywell:thermostat' } }, rooms, { today: day(0), tomorrow: day(1) }, config, now, {version: 1, day: localDay(now), updatedAt: Math.floor(now.getTime()/1000),
      enabled: true, phase: 'solar-and-reserve', capacityKwh: 5, topUpW: 1000, targetPercent: 100,
      reserveMinute: 540, deadlineMinute: 1020, startMinute: 888}),
    demo: true, status: 'demo', errors: [], updatedAt: now.toISOString(), day: localDay(now) };
}
