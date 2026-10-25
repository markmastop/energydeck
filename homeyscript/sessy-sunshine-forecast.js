/* Replace fetchExpectedSunshineComingHours; keep its existing hourly schedule.
 * Open-Meteo sunshine is seconds over the PRECEDING 15 minutes. Unix timestamps
 * avoid local-clock/DST ambiguity; partial quarters are prorated estimates.
 */
const LATITUDE = Number('__LATITUDE__');
const LONGITUDE = Number('__LONGITUDE__');
const now = Math.floor(new Date().getTime() / 1000);
const variables = Object.values(await Homey.logic.getVariables());
const cache = variables.find(v => v.name === 'sessy_sunshine_forecast' && v.type === 'string');
if (!cache) throw new Error('Missing sessy_sunshine_forecast variable');
async function save(value) {
  await Homey.logic.updateVariable({id: cache.id, variable: {value: JSON.stringify(value)}});
}
try {
  if (!Number.isFinite(LATITUDE) || !Number.isFinite(LONGITUDE) || Math.abs(LATITUDE) > 90 || Math.abs(LONGITUDE) > 180) {
    throw new Error('Invalid forecast location');
  }
  const query = new URLSearchParams({latitude: String(LATITUDE), longitude: String(LONGITUDE),
    minutely_15: 'sunshine_duration', forecast_minutely_15: '16', past_minutely_15: '1',
    timeformat: 'unixtime', timezone: 'GMT'});
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw new Error('Forecast request failed');
  const data = await response.json();
  const times = data.minutely_15?.time, seconds = data.minutely_15?.sunshine_duration;
  if (data.minutely_15_units?.sunshine_duration !== 's' || !Array.isArray(times) ||
      !Array.isArray(seconds) || times.length !== seconds.length || times.length > 64) {
    throw new Error('Unexpected forecast units/schema');
  }
  const periods = [];
  for (let i = 0; i < times.length; i++) {
    const end = times[i], sun = seconds[i];
    if (!Number.isInteger(end) || (i && end - times[i - 1] !== 900) ||
        typeof sun !== 'number' || !Number.isFinite(sun) || sun < 0 || sun > 900) {
      throw new Error('Invalid forecast interval');
    }
    if (end > now && end - 900 < now + 10800) periods.push({start: end - 900, end, sunMinutes: sun / 60});
  }
  if (!periods.length || periods[0].start > now || periods.at(-1).end < now + 10800) {
    throw new Error('Incomplete next-three-hour forecast');
  }
  const minutes = periods.reduce((sum, p) => sum + p.sunMinutes *
    (Math.min(p.end, now + 10800) - Math.max(p.start, now)) / 900, 0);
  await save({version: 1, valid: true, source: 'open-meteo', updatedAt: now, periods});
  // Retain the existing public variable, now with explicit seconds conversion
  // even when every forecast value is below 60 seconds.
  const legacy = variables.find(v => v.name === 'ExpectedSunshineMinutes' && v.type === 'number');
  if (legacy && legacy.value !== Math.ceil(minutes)) {
    await Homey.logic.updateVariable({id: legacy.id, variable: {value: Math.ceil(minutes)}});
  }
  return {ok: true, sunshineMinutes: Math.ceil(minutes), horizonMinutes: 180};
} catch (error) {
  await save({version: 1, valid: false, source: 'open-meteo', updatedAt: now});
  throw error;
}
