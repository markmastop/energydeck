import { AppError, boundedFetch, singleFlight } from './net.mjs';
import { localDay, chargerState } from './data.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const enabled = id => !!id && id !== 'none';

export function dayBounds(now) {
  function midnight(date) {
    const utc = new Date(`${date}T00:00:00Z`);
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', timeZoneName: 'shortOffset' })
      .formatToParts(utc).find(p => p.type === 'timeZoneName').value;
    return utc.getTime() - Number(zone.match(/GMT\+(\d+)/)?.[1] || 0) * 3600000;
  }
  return { start: midnight(localDay(now)), end: midnight(localDay(now, 1)) };
}

export function historySeries(raw, now, signed = false) {
  const { start, end } = dayBounds(now);
  const points = [];
  if (Array.isArray(raw?.values) && raw.values.length <= 310) {
    for (const value of raw.values) {
      const time = typeof value.t === 'string' && /Z$/.test(value.t) ? Date.parse(value.t) : NaN;
      if (!Number.isFinite(time) || time < start || time >= end || time > now.getTime() ||
          finite(value.v) === null || (!signed && value.v < 0) || (points.length && time <= points.at(-1).time)) continue;
      points.push({ time, value: value.v / (signed ? 1000 : 1) });
    }
  }
  const stale = !points.length || now.getTime() - points.at(-1).time > 900000;
  return { start, end, points: stale ? [] : points, stale };
}

export function rainSeries(raw, now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minutes = Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
  const rows = raw.trim().split(/\r?\n/);
  if (rows.length < 24 || rows.length > 25) return null;
  let first;
  const points = [];
  for (let i = 0; i < rows.length; i++) {
    const match = rows[i].match(/^(\d{1,3})\|(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [code, hour, minute] = match.slice(1).map(Number);
    if (code > 255 || hour > 23 || minute > 59) return null;
    const current = hour * 60 + minute;
    if (!i) first = current;
    if ((current - first + 1440) % 1440 !== i * 5) return null;
    const delta = (current - minutes + 2160) % 1440 - 720;
    if (!i && Math.abs(delta) > 10) return null;
    const time = Math.floor(now.getTime() / 60000) * 60000 + delta * 60000;
    if (time + 300000 > now.getTime()) points.push({ time, value: code === 0 ? 0 : 10 ** ((code - 109) / 32) });
  }
  return { points: points.slice(0, 24) };
}

export function temperatureInThreeHours(hourly, now) {
  const target = now.getTime() / 1000 + 10800;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.temperature_2m)) return null;
  for (let i = 1; i < hourly.time.length; i++) {
    const a = hourly.time[i - 1], b = hourly.time[i];
    if (b - a !== 3600 || target < a || target > b || finite(hourly.temperature_2m[i - 1]) === null || finite(hourly.temperature_2m[i]) === null) continue;
    return hourly.temperature_2m[i - 1] + (hourly.temperature_2m[i] - hourly.temperature_2m[i - 1]) * (target - a) / 3600;
  }
  return null;
}

export function createExtrasService(config, fetcher = fetch, clock = () => new Date()) {
  async function homey(path, options = {}) {
    if (!config.address || !config.token) throw new AppError('unconfigured', 503);
    const { body } = await boundedFetch(`${config.address}/api/manager/${path}`, {
      ...options, headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    }, fetcher);
    return body.length ? JSON.parse(body.toString()) : {};
  }
  const history = singleFlight(async () => {
    const now = clock();
    const id = config.devices.grid;
    const read = async capability => {
      if (config.demo) return demoHistory(now, capability === 'energy_power');
      try {
        if (!enabled(id)) throw new Error('missing');
        const owner = `homey:device:${id}`;
        return historySeries(await homey(`insights/log/${encodeURIComponent(owner)}/${encodeURIComponent(`${owner}:${capability}`)}/entry?resolution=today`), now, capability === 'energy_power');
      } catch { return historySeries(null, now, capability === 'energy_power'); }
    };
    const [power, gas] = await Promise.all([read('energy_power'), read('measure_gas')]);
    return { power, gas, updatedAt: now.toISOString(), demo: config.demo };
  }, 240000, () => clock().getTime(), () => localDay(clock()));

  const weather = singleFlight(async () => {
    const now = clock();
    if (config.demo) return demoWeather(now);
    let summary = null, rain = null, temperature3h = null, sunrise = null, sunset = null;
    const jobs = [async () => {
      try {
        const raw = await homey('weather/weather');
        const condition = icon => ['thunder', 'rain', 'snow', 'fog', 'cloud', 'clear'].find(key => String(icon).includes(key)) || 'unknown';
        summary = { temperature: finite(raw.temperature), condition: condition(raw.iconId),
          tomorrowMin: finite(raw.forecast?.[0]?.temperatureMin), tomorrowMax: finite(raw.forecast?.[0]?.temperatureMax),
          tomorrowCondition: condition(raw.forecast?.[0]?.iconId) };
      } catch { /* Optional sources fail independently, never erase a successful source. */ }
    }];
    if (Number.isFinite(config.latitude) && Math.abs(config.latitude) <= 90 && Number.isFinite(config.longitude) && Math.abs(config.longitude) <= 180) {
      jobs.push(async () => {
        try {
          const { body } = await boundedFetch(`https://gadgets.buienradar.nl/data/raintext/?lat=${config.latitude.toFixed(2)}&lon=${config.longitude.toFixed(2)}`, {}, fetcher, 4096);
          rain = rainSeries(body.toString(), now);
        } catch { /* No invented dry forecast when the provider is unavailable. */ }
      }, async () => {
        try {
          const query = new URLSearchParams({ latitude: String(config.latitude), longitude: String(config.longitude), hourly: 'temperature_2m',
            daily: 'sunrise,sunset', forecast_days: '2', timeformat: 'unixtime', timezone: 'Europe/Amsterdam' });
          const { body } = await boundedFetch(`https://api.open-meteo.com/v1/forecast?${query}`, {}, fetcher, 65536);
          const raw = JSON.parse(body.toString());
          temperature3h = temperatureInThreeHours(raw.hourly, now);
          const index = raw.daily?.time?.findIndex(time => localDay(new Date(time * 1000)) === localDay(now));
          if (index >= 0) {
            sunrise = finite(raw.daily.sunrise?.[index]); sunset = finite(raw.daily.sunset?.[index]);
            sunrise = sunrise === null ? null : sunrise * 1000; sunset = sunset === null ? null : sunset * 1000;
          }
        } catch { /* Forecast absence stays explicit. */ }
      });
    }
    await Promise.all(jobs.map(job => job()));
    return { summary, rain, temperature3h, sunrise, sunset, updatedAt: now.toISOString(), demo: false };
  }, 300000, () => clock().getTime(), () => localDay(clock()));

  let chargeBusy = false, lastCharge = 0, lastTarget = null;
  return { history, weather,
    async charge(body) {
      if (body?.confirm !== true) throw new AppError('confirmationRequired', 400);
      if (typeof body.target !== 'boolean') throw new AppError('invalidCommand', 400);
      if (!enabled(config.chargeFlow)) throw new AppError('unconfigured', 503);
      if (chargeBusy || body.target === lastTarget && clock().getTime() - lastCharge < 180000) throw new AppError('commandBusy', 409);
      chargeBusy = true;
      try {
        if (!config.demo) {
          const device = await homey(`devices/device/${encodeURIComponent(config.devices.charger)}`);
          const caps = device?.capabilitiesObj;
          // Recheck the same effective charging state shown by the ESP and web UI.
          const state = chargerState(device);
          if (device.available === false || caps?.is_connected?.value !== true || caps?.alarm_device?.value !== false || typeof state.charging !== 'boolean' || state.charging === body.target)
            throw new AppError('chargerNotReady', 409);
        }
        // Reserve before the write. A missing response never authorizes a duplicate trigger.
        lastCharge = clock().getTime();
        lastTarget = body.target;
        if (config.demo) config.demoState.charging = body.target;
        if (!config.demo) {
          try { await homey(`flow/advancedflow/${encodeURIComponent(config.chargeFlow)}/trigger`, { method: 'POST', body: '{}' }); }
          catch (error) {
            // Only a definitive missing Advanced Flow permits the regular-Flow fallback.
            if (error.status !== 404) throw error;
            await homey(`flow/flow/${encodeURIComponent(config.chargeFlow)}/trigger`, { method: 'POST', body: '{}' });
          }
        }
        return { ok: true, pending: true, target: body.target, demo: config.demo };
      } finally { chargeBusy = false; }
    },
  };
}

function demoHistory(now, signed) {
  const { start, end } = dayBounds(now);
  const points = [];
  for (let time = start, index = 0; time <= now.getTime(); time += 300000, index++) {
    if (index === 36 || index === 37) continue;
    const hour = (time - start) / 3600000;
    points.push({ time, value: signed ? .7 + .6 * Math.sin(hour * 1.8) - 2 * Math.max(0, Math.sin((hour - 7) / 12 * Math.PI)) : Math.max(0, .1 + .15 * Math.sin(hour * 1.7)) });
  }
  return { start, end, points, stale: false };
}

function demoWeather(now) {
  return { summary: { temperature: 15.8, condition: 'cloud', tomorrowMin: 11, tomorrowMax: 18, tomorrowCondition: 'rain' }, temperature3h: 14.2,
    sunrise: new Date(`${localDay(now)}T06:10:00Z`).getTime(), sunset: new Date(`${localDay(now)}T16:30:00Z`).getTime(),
    rain: { points: Array.from({ length: 24 }, (_, i) => ({ time: Math.floor(now.getTime() / 300000) * 300000 + i * 300000, value: i > 5 && i < 15 ? Math.sin((i - 5) / 10 * Math.PI) * 3 : 0 })) },
    updatedAt: now.toISOString(), demo: true };
}
