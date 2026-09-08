/*
 * EnergyDeck price bridge for HomeyScript.
 *
 * Run this script on Homey Pro. It reads Homey's internal dynamic prices and
 * stores them in a Logic variable that EnergyDeck can read with a restricted
 * API Key.
 */

const VARIABLE_NAME = 'EnergyDeck Prices';

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = name => parts.find(item => item.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const date = localDate();
// Advance a calendar date, not the host's local clock or a DST-length day.
const nextDay = new Date(`${date}T12:00:00Z`);
nextDay.setUTCDate(nextDay.getUTCDate() + 1);
const tomorrowDate = nextDay.toISOString().slice(0, 10);
const warnings = [];
const sources = {};
const homeyAvailable = {};
const fetchedAt = {};
const cachedDays = [];
const variables = await Homey.logic.getVariables();
const existing = Object.values(variables).find(v => v.name === VARIABLE_NAME);
let previous = {};
try { previous = JSON.parse(existing?.value || '{}'); } catch (_) {}
function validValues(values) {
  return Array.isArray(values) && values.length === 96 &&
    values.every(v => typeof v === 'number' && Number.isFinite(v));
}

// Internal website endpoint: raw NL spot prices in EUR/kWh, not the
// provider-specific /api/v1 tariffs. The deck alone adds taxes and fees.
let reserveResponse;
async function fetchReserve(day) {
  // One snapshot per script run, shared by both requested days.
  if (!reserveResponse) reserveResponse = (async () => {
    const response = await fetch('https://epexprijzen.nl/api/prices');
    if (!response.ok) throw new Error(`EpexPrijzen HTTP ${response.status}`);
    return response.json();
  })();
  const data = await reserveResponse;
  if (!Array.isArray(data?.today) || (data.tomorrow != null && !Array.isArray(data.tomorrow))) {
    throw new Error('EpexPrijzen: unexpected response structure');
  }
  const samples = [...data.today, ...(data.tomorrow || [])].map(item => ({
    time: typeof item?.date === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(item.date)
      ? Date.parse(item.date) / 1000 : NaN,
    value: item?.price,
  }));
  if (samples.some(s => !Number.isInteger(s.time) || typeof s.value !== 'number' || !Number.isFinite(s.value))) {
    throw new Error('EpexPrijzen: invalid timestamp or price');
  }
  const selected = samples.filter(s => localDate(new Date(s.time * 1000)) === day);
  // The current deck requires 96 actual quarter-hours; never expand hourly prices
  // or silently flatten DST days (92/100 quarters) into an ordinary day.
  if (selected.length !== 96 || selected.some((s, i) => i && s.time - selected[i - 1].time !== 900)) {
    throw new Error('EpexPrijzen: incomplete quarter-hour day');
  }
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  if (timeFormat.format(new Date(selected[0].time * 1000)) !== '00:00' ||
      timeFormat.format(new Date(selected[95].time * 1000)) !== '23:45') {
    throw new Error('EpexPrijzen: wrong day boundaries');
  }
  return selected.map(s => s.value);
}

function compactPrices(result) {
  const intervals = result?.pricesPerInterval ?? [];
  if (!Array.isArray(intervals) || intervals.some(interval =>
    typeof interval?.value !== 'number' || !Number.isFinite(interval.value))) {
    throw new Error('Invalid price intervals: expected finite numeric values');
  }
  return intervals.map(interval => interval.value);
}

async function fetchDay(day) {
  try {
    const values = compactPrices(await Homey.energy.fetchDynamicElectricityPrices({ date: day }));
    if (values.length !== 96) throw new Error('Expected 96 quarter-hour prices');
    sources[day] = 'Homey';
    homeyAvailable[day] = true;
    fetchedAt[day] = new Date().toISOString();
    log(`EnergyDeck prices ${day}: ${values.length} intervals loaded`);
    return values;
  } catch (error) {
    homeyAvailable[day] = false;
    const message = `EnergyDeck prices ${day}: ${error?.message || error?.name || String(error)}`;
    log(message);
    warnings.push(message);
    try {
      const values = await fetchReserve(day);
      sources[day] = 'EpexPrijzen.nl (raw EUR/kWh)';
      fetchedAt[day] = new Date().toISOString();
      log(`EnergyDeck prices ${day}: reserve source loaded 96 intervals`);
      return values;
    } catch (reserveError) {
      const failure = `EnergyDeck reserve ${day}: ${reserveError.message}`;
      warnings.push(failure);
      log(failure);
      // Retain only a complete matching calendar day, including yesterday's tomorrow.
      const cached = [previous.today, previous.tomorrow].find(d => d?.date === day && validValues(d.values));
      if (cached) {
        sources[day] = previous.sources?.[day] ||
          (cached.source === 'homey' ? 'Homey' : cached.source === 'epexprijzen' ? 'EpexPrijzen.nl (raw EUR/kWh)' : 'Onbekend');
        fetchedAt[day] = previous.fetchedAt?.[day] || previous.updatedAt || '';
        cachedDays.push(day);
        warnings.push(`${day}: eerder opgeslagen dagprijzen gebruikt`);
        return cached.values;
      }
    }
    // Tomorrow may not be published yet. Never block today's update for it.
    sources[day] = 'Geen';
    fetchedAt[day] = '';
    return [];
  }
}

const todayValues = await fetchDay(date);
const tomorrowValues = await fetchDay(tomorrowDate);

// Preserve the firmware's per-day provenance alongside the Flow diagnostics.
function daySource(day, values) {
  if (!values.length) return 'unavailable';
  return sources[day] === 'Homey' ? 'homey' : sources[day]?.startsWith('EpexPrijzen') ? 'epexprijzen' : 'unknown';
}
const value = JSON.stringify({
  version: 2,
  updatedAt: fetchedAt[date] || previous.updatedAt || null,
  checkedAt: new Date().toISOString(),
  sources,
  homeyAvailable,
  fetchedAt,
  cachedDays,
  warnings,
  today: {
    date,
    values: todayValues,
    source: daySource(date, todayValues),
  },
  tomorrow: {
    date: tomorrowDate,
    values: tomorrowValues,
    source: daySource(tomorrowDate, tomorrowValues),
  },
});

let variable;
if (existing) {
  variable = await Homey.logic.updateVariable({
    id: existing.id,
    variable: { value },
  });
} else {
  variable = await Homey.logic.createVariable({
    variable: {
      name: VARIABLE_NAME,
      type: 'string',
      value,
    },
  });
}

return {
  ok: validValues(todayValues),
  date,
  tomorrowDate,
  todayIntervals: todayValues.length,
  tomorrowIntervals: tomorrowValues.length,
  warnings,
  sources,
  homeyAvailable,
  cachedDays,
  variableId: variable.id,
  bytes: value.length,
};
