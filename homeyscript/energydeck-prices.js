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

// Energy-Charts publishes NL spot prices from Bundesnetzagentur | SMARD.de
// under CC BY 4.0: https://api.energy-charts.info/ (converted EUR/MWh -> EUR/kWh).
// Do not add tax or supplier fees: the deck already applies those.
async function fetchReserve(day) {
  const response = await fetch(`https://api.energy-charts.info/price?bzn=NL&start=${day}&end=${day}`);
  if (!response.ok) throw new Error(`Energy-Charts HTTP ${response.status}`);
  const data = await response.json();
  if (data.unit !== 'EUR / MWh' || !Array.isArray(data.unix_seconds) ||
      !Array.isArray(data.price) || data.price.length !== data.unix_seconds.length) {
    throw new Error('Energy-Charts: unexpected units or arrays');
  }
  const samples = data.unix_seconds.map((time, i) => ({time, value: data.price[i]}));
  if (samples.some(s => !Number.isInteger(s.time) || typeof s.value !== 'number' || !Number.isFinite(s.value))) {
    throw new Error('Energy-Charts: invalid timestamp or price');
  }
  const selected = samples.filter(s => localDate(new Date(s.time * 1000)) === day);
  // The current deck requires 96 actual quarter-hours; never expand hourly prices
  // or silently flatten DST days (92/100 quarters) into an ordinary day.
  if (selected.length !== 96 || selected.some((s, i) => i && s.time - selected[i - 1].time !== 900)) {
    throw new Error('Energy-Charts: incomplete quarter-hour day');
  }
  const timeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  if (timeFormat.format(new Date(selected[0].time * 1000)) !== '00:00' ||
      timeFormat.format(new Date(selected[95].time * 1000)) !== '23:45') {
    throw new Error('Energy-Charts: wrong day boundaries');
  }
  return selected.map(s => s.value / 1000);
}

function compactPrices(result) {
  const intervals = result?.pricesPerInterval ?? [];
  if (!Array.isArray(intervals) || intervals.some(interval =>
    typeof interval?.value !== 'number' || !Number.isFinite(interval.value))) {
    throw new Error('Invalid price intervals: expected finite numeric values');
  }
  return intervals.map(interval => interval.value);
}

async function fetchDay(day, required) {
  try {
    const values = compactPrices(await Homey.energy.fetchDynamicElectricityPrices({ date: day }));
    if (values.length !== 96) throw new Error('Expected 96 quarter-hour prices');
    sources[day] = 'Homey';
    log(`EnergyDeck prices ${day}: ${values.length} intervals loaded`);
    return values;
  } catch (error) {
    const message = `EnergyDeck prices ${day}: ${error?.message || error?.name || String(error)}`;
    log(message);
    warnings.push(message);
    try {
      const values = await fetchReserve(day);
      sources[day] = 'Energy-Charts / Bundesnetzagentur | SMARD.de (CC BY 4.0)';
      log(`EnergyDeck prices ${day}: reserve source loaded 96 intervals`);
      return values;
    } catch (reserveError) {
      const failure = `EnergyDeck reserve ${day}: ${reserveError.message}`;
      warnings.push(failure);
      log(failure);
      if (required) throw new Error(`${message}; ${failure}`);
    }
    // Tomorrow may not be published yet. Never block today's update for it.
    return [];
  }
}

const todayValues = await fetchDay(date, true);
const tomorrowValues = await fetchDay(tomorrowDate, false);

const value = JSON.stringify({
  version: 2,
  updatedAt: new Date().toISOString(),
  today: {
    date,
    values: todayValues,
  },
  tomorrow: {
    date: tomorrowDate,
    values: tomorrowValues,
  },
});

const variables = await Homey.logic.getVariables();
const existing = Object.values(variables).find(
  variable => variable.name === VARIABLE_NAME,
);

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
  ok: true,
  date,
  tomorrowDate,
  todayIntervals: todayValues.length,
  tomorrowIntervals: tomorrowValues.length,
  warnings,
  sources,
  variableId: variable.id,
  bytes: value.length,
};
