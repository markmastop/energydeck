/*
 * Normal-control step in the existing Sessy - Run Advanced Flow.
 * The installer binds the device ID. This script only updates the existing
 * target variable; the Flow remains the sole sender of device commands.
 */
const DEVICE_ID = '__SESSY_DEVICE_ID__';
const CAPACITY_KWH = 5;
const MAX_CHARGE_W = 2200;
const TOP_UP_W = 1000; // Earlier, gentler grid charging; solar may still use the device limit.
const MAX_DISCHARGE_W = 1800;
const CHARGE_EFFICIENCY = 0.90; // Conservative planning allowance, not a measured efficiency.
const RESERVE_FROM_MINUTE = 9 * 60;
const DEADLINE_MINUTE = 17 * 60;
const FINISH_MARGIN_MINUTES = 45; // Allow for tapering near full and short control interruptions.

const variables = Object.values(await Homey.logic.getVariables());
function variable(name, type) {
  const found = variables.filter(v => v.name === name && v.type === type);
  if (found.length !== 1) throw new Error(`Missing or ambiguous Logic variable: ${name}`);
  return found[0];
}
const target = variable('sessy_doel_vermogen', 'number');
const demand = variable('sessy_werkelijk_vermogen', 'number');
const enabled = variable('sessy_ready_by_17_enabled', 'boolean');
const saved = variable('sessy_ready_by_17_state', 'string');
const published = variable('sessy_ready_by_17_plan', 'string');
if (!Number.isFinite(target.value) || !Number.isFinite(demand.value)) {
  throw new Error('Invalid Sessy target or household demand');
}
const now = new Date();
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).formatToParts(now).map(p => [p.type, p.value]));
const day = `${parts.year}-${parts.month}-${parts.day}`;
const minute = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
let previous = {};
try { previous = JSON.parse(saved.value); } catch (_) {}
const wasToppingUp = previous?.toppingUp === true;
const latchedToday = wasToppingUp && previous?.day === day;
// Do not carry the forced negative target into normal control after 17:00.
let watts = (wasToppingUp ? 0 : target.value) * 2 / 3 + demand.value / 3;
let toppingUp = false;
let reason = enabled.value === true ? 'normal' : 'disabled';
let soc = null;
let latestStartMinute = null;
let chargeLimitW = MAX_CHARGE_W;
let startedMinute = previous?.day === day && Number.isFinite(previous?.startedMinute) ? previous.startedMinute : null;

if (enabled.value === true && minute >= RESERVE_FROM_MINUTE && minute < DEADLINE_MINUTE) {
  const device = await Homey.devices.getDevice({id: DEVICE_ID});
  const caps = device.capabilitiesObj || {};
  soc = caps.measure_battery?.value;
  if (device.available === false || caps.alarm_fault?.value === true ||
      typeof soc !== 'number' || !Number.isFinite(soc) || soc < 0 || soc > 100) {
    throw new Error('Sessy unavailable, faulted, or state of charge invalid');
  }
  const configuredLimit = device.settings?.power_max_charge;
  if (typeof configuredLimit === 'number' && configuredLimit < TOP_UP_W) {
    throw new Error('Sessy charge limit is lower than the planner setting');
  }
  if (Number.isFinite(configuredLimit)) chargeLimitW = Math.min(MAX_CHARGE_W, configuredLimit);
  const inputKwh = CAPACITY_KWH * (100 - soc) / 100 / CHARGE_EFFICIENCY;
  latestStartMinute = DEADLINE_MINUTE - FINISH_MARGIN_MINUTES - inputKwh / (TOP_UP_W / 1000) * 60;
  toppingUp = soc < 100 && (latchedToday || minute >= latestStartMinute);
  if (toppingUp) {
    if (!latchedToday || startedMinute === null) startedMinute = minute;
    // Negative target watts mean charging. The latch avoids cycling whenever
    // the integer SoC rises and moves the recalculated latest start forward.
    // Household demand already excludes battery power. A larger negative
    // value is available solar surplus, which should not be exported just
    // because grid top-up is limited to 1 kW.
    watts = Math.min(-TOP_UP_W, demand.value);
    reason = 'grid-top-up';
  } else {
    watts = soc >= 100 ? 0 : Math.min(0, watts);
    reason = soc >= 100 ? 'full-reserve' : 'solar-and-reserve';
  }
}

watts = Math.round(Math.max(-chargeLimitW, Math.min(MAX_DISCHARGE_W, watts)));
// Persist the latch before the target. A failed write must stop this Flow path;
// its error branch sets a zero target and uses the normal stop command.
const state = JSON.stringify({day, toppingUp, startedMinute});
if (saved.value !== state) await Homey.logic.updateVariable({id: saved.id, variable: {value: state}});
await Homey.logic.updateVariable({id: target.id, variable: {value: watts}});
// Read-only clients share this controller snapshot instead of copying its
// planning assumptions. A minute timestamp bounds writes and reveals stopped
// normal control (for example a manual override) through snapshot expiry.
const plan = JSON.stringify({version: 1, day, updatedAt: Math.floor(now.getTime() / 60000) * 60,
  enabled: enabled.value === true, phase: reason, capacityKwh: CAPACITY_KWH,
  topUpW: TOP_UP_W, targetPercent: 100, reserveMinute: RESERVE_FROM_MINUTE,
  deadlineMinute: DEADLINE_MINUTE,
  startMinute: toppingUp || reason === 'full-reserve' || reason === 'normal' ?
    (startedMinute === null ? null : Math.floor(startedMinute)) :
    latestStartMinute === null ? null : Math.ceil(Math.max(RESERVE_FROM_MINUTE, latestStartMinute))});
if (published.value !== plan) await Homey.logic.updateVariable({id: published.id, variable: {value: plan}});
return {reason, targetW: watts, soc, latestStartMinute, deadline: '17:00', timeZone: 'Europe/Amsterdam'};
