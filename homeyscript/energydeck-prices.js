/*
 * EnergyDeck price bridge for HomeyScript.
 *
 * Run this script on Homey Pro. It reads Homey's internal dynamic prices and
 * stores them in a Logic variable that EnergyDeck can read with a restricted
 * API Key.
 */

const VARIABLE_NAME = 'EnergyDeck Prices';

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const date = localDate();
const prices = await Homey.energy.fetchDynamicElectricityPrices({ date });
const value = JSON.stringify({
  version: 1,
  date,
  updatedAt: new Date().toISOString(),
  prices,
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
  variableId: variable.id,
  bytes: value.length,
};
