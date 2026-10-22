// Mirrors energy_state.h: thresholds and the 10-second hold belong to the display contract.
export function createDisplayState() {
  const modes = {};
  const stable = (key, next, now) => {
    if (next < 0) { delete modes[key]; return -1; }
    const mode = modes[key] ||= { value: next, candidate: next, since: now };
    if (mode.candidate !== next) { mode.candidate = next; mode.since = now; }
    if (now - mode.since >= 10000) mode.value = mode.candidate;
    return mode.value;
  };
  const known = value => typeof value === 'number' && Number.isFinite(value);
  return {
    reset() { for (const key of Object.keys(modes)) delete modes[key]; },
    update(data, now = Date.now()) {
      const { grid, gas, solar, battery, charger, climate } = data;
      const gridMode = stable('grid', !known(grid.power) ? -1 : grid.power < -50 ? 1 : grid.power > 50 ? 0 : modes.grid?.value ?? 0, now);
      const gasMode = stable('gas', !known(gas.rate) ? -1 : gas.rate > .005 ? 1 : 0, now);
      const sun = known(solar.power), storage = known(battery.percentage) && known(battery.power);
      let source = stable('source', !sun && !storage ? -1 : !sun ? 1 : !storage ? 0 : battery.power > 50 || solar.power <= 50 ? 1 : 0, now);
      // Missing source data disappears immediately, including during a mode hold.
      if (source === 1 && !storage) source = 0;
      else if (source === 0 && !sun) source = 1;
      return {
        gridMode, gridPending: known(grid.power) && (grid.power < -50 && gridMode === 0 || grid.power > 50 && gridMode === 1),
        gasMode, source,
        heat: climate?.demand === 'demand' ? 'orange' : climate?.demand === 'idle' ? 'green' : 'dim',
        car: charger.connected === true ? charger.fault === false && charger.charging === true ? 'green' : 'blue' : 'dim',
        battery: !known(battery.power) ? 'dim' : battery.power < -25 ? 'blue' : battery.power > 25 ? 'green' : 'dim',
      };
    },
  };
}

export function powerArc(watts) {
  // C++ round() rounds negative halves away from zero; JavaScript Math.round() does not.
  if (typeof watts !== 'number' || !Number.isFinite(watts)) return 0;
  const amount = Math.min(100, Math.round(Math.abs(watts) / 50));
  return amount ? Math.sign(watts) * amount : 0;
}

export function dayComparison(today, tomorrow) {
  if (!today || !tomorrow) return null;
  const difference = tomorrow.average - today.average;
  if (!Number.isFinite(difference)) return null;
  return { difference, label: difference < -.05 ? 'tomorrowCheaper' : difference > .05 ? 'tomorrowDearer' : 'tomorrowEqual' };
}
