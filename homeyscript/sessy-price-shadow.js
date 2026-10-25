// Bundled by the installer with the canonical web tariff/calendar functions and
// the pure planner. Called only from normal control, never from manual branches.
async function forwardSessyPlan(variables, now, deviceId, previous) {
  const epoch = Math.floor(now.getTime() / 1000);
  const device = await Homey.devices.getDevice({id:deviceId});
  const soc = device.capabilitiesObj?.measure_battery?.value;
  if (device.available === false || device.capabilitiesObj?.alarm_fault?.value === true ||
      typeof soc !== 'number' || !Number.isFinite(soc) || soc < 0 || soc > 100) return null;
  const find = name => variables.find(v => v.name === name && v.type === 'string');
  const parse = raw => { try { return JSON.parse(raw); } catch (_) { return null; } };
  const inputs = parse(find('sessy_price_inputs')?.value);
  const bridgeVar = variables.find(v => v.id === '__SESSY_PRICES_VARIABLE_ID__');
  const bridge = parse(bridgeVar?.value);
  if (!bridge) return null;
  const evDevice = await Homey.devices.getDevice({id:'__SESSY_CHARGER_DEVICE_ID__'}).catch(() => null);
  const evCaps = evDevice?.capabilitiesObj || {};
  const evPower = evCaps.measure_power?.value, evFlag = evCaps.is_charging?.value;
  const ev = evDevice?.available === false || evCaps.alarm_device?.value !== false ||
    typeof evPower !== 'number' || !Number.isFinite(evPower) || typeof evFlag !== 'boolean' ? null : evFlag || evPower > 50;
  // Replan at least every five minutes and immediately after SoC, EV, price,
  // forecast, or input changes. A cached proposal never refreshes its own age.
  const sun = parse(find('sessy_sunshine_forecast')?.value);
  let hash = 2166136261;
  for (const char of JSON.stringify([bridge, inputs, sun?.updatedAt])) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const key = `${Math.floor(epoch / 300)}:${soc}:${ev}:${hash >>> 0}`;
  if (previous?.mode === 'shadow' && previous.inputKey === key && previous.validUntil > epoch) return previous;
  const slots = [], hour = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'});
  for (const date of [localDay(now), localDay(now, 1)]) {
    const day = priceDay(bridge, date, __SESSY_TARIFF__);
    if (!day || day.source === 'unknown') break;
    for (let i = 0; i < day.values.length; i++) {
      const from = Math.max(epoch, day.start / 1000 + i * 900), until = day.start / 1000 + (i + 1) * 900;
      if (until <= epoch || until > epoch + 36 * 3600) continue;
      const h = Number(hour.format(new Date(from * 1000)));
      const forecast = inputs?.version === 1 && inputs.validUntil > epoch && inputs.updatedAt <= epoch + 30 &&
        inputs.updatedAt >= epoch - 900 && Array.isArray(inputs.periods) ?
        inputs.periods.find(p => p.from <= from && p.until >= until) : null;
      // Provisional consumption/headroom are deliberately labelled assumptions.
      // They illustrate price allocation and cannot authorise actuator writes.
      const expectedEv = forecast ? forecast.ev : h < 6;
      const q = {from,until,price:day.values[i],houseW:forecast?.houseW ?? (h >= 6 && h < 10 ? 900 : h >= 17 && h < 22 ? 700 : 350),
        pvW:forecast?.pvW ?? 0,ev:slots.length ? expectedEv : ev,
        headroomW:forecast ? forecast.headroomW : 1000,source:day.source,sun:null};
      if (sun?.version === 1 && sun.valid === true && sun.source === 'open-meteo' &&
          sun.updatedAt <= epoch + 30 && sun.updatedAt >= epoch - 4500 && Array.isArray(sun.periods)) {
        const periods = Array.isArray(sun.forwardPeriods) && sun.forwardPeriods.length <= 145 ? sun.forwardPeriods : sun.periods;
        const part = periods.find(p => Number.isInteger(p.start) && Number.isInteger(p.end) && p.start <= from && p.end >= until && p.end - p.start === 900);
        if (part && typeof part.sunMinutes === 'number' && Number.isFinite(part.sunMinutes) && part.sunMinutes >= 0 && part.sunMinutes <= 15) q.sun = part.sunMinutes / 15;
      }
      slots.push(q);
    }
  }
  if (!slots.length) return null;
  const result = planSessy({now:epoch,soc,slots,inputQuality:'provisional'});
  result.inputKey = key;
  result.source = [...new Set(slots.map(q => q.source))].join('+');
  return result;
}
