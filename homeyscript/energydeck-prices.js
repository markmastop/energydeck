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
    if (!values.length) throw new Error('No price intervals available');
    log(`EnergyDeck prices ${day}: ${values.length} intervals loaded`);
    return values;
  } catch (error) {
    const message = `EnergyDeck prices ${day}: ${error?.message || error?.name || String(error)}`;
    log(message);
    if (required) throw new Error(message);
    warnings.push(message);
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
  variableId: variable.id,
  bytes: value.length,
};
