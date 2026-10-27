// Pure quarter-hour optimiser. Prices are all-in ct/kWh; positive power supplies
// the house, negative power charges. No Homey/device writes belong in this file.
export function planSessy(input) {
  const {now, soc, slots} = input;
  const capacity = input.capacityKwh ?? 5, reserve = input.reservePercent ?? 2;
  const terminal = input.endReservePercent ?? 20, etaC = input.chargeEfficiency ?? .90;
  const etaD = input.dischargeEfficiency ?? .95, wear = input.wearCt ?? 3;
  const chargeW = input.chargeW ?? 1000, dischargeW = input.dischargeW ?? 1800;
  const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!finite(now, 1, 1e11) || !finite(soc, 0, 100) || !finite(capacity, 1, 100) ||
      !finite(reserve, 0, 50) || !finite(terminal, reserve, 100) ||
      !finite(etaC, .5, 1) || !finite(etaD, .5, 1) || !finite(wear, 0, 100) ||
      !finite(chargeW, 0, 1000) || !finite(dischargeW, 0, 1800) ||
      !Array.isArray(slots) || !slots.length || slots.length > 145) throw new Error('Invalid planner inputs');
  for (let i = 0; i < slots.length; i++) {
    const q = slots[i];
    if (!finite(q.from, now, now + 36 * 3600) || !finite(q.until, q.from + 1, q.from + 900) ||
        q.until > now + 36 * 3600 || (i ? q.from !== slots[i - 1].until : q.from !== now) ||
        !finite(q.price, -1000, 1000) || !finite(q.houseW, 0, 30000) ||
        !finite(q.pvW, 0, 30000) || ![true, false, null].includes(q.ev) ||
        !(q.headroomW === null || finite(q.headroomW, 0, 100000))) throw new Error('Invalid or discontinuous forecast');
  }
  // 10 Wh states give bounded runtime on Homey. Floors deliberately never
  // allocate more power than an interval can supply, including partial quarters.
  const step = capacity / 500, max = 500, initial = Math.floor(soc * 5 + 1e-8);
  const minimum = Math.ceil(reserve * 5), ending = Math.ceil(terminal * 5);
  const floor = Math.min(minimum, initial); // Low SoC may recover; never discharge it further.
  let future = new Float64Array(max + 1);
  const shortageCost = Math.max(...slots.map(q => q.price), 0) / etaC + wear + 100;
  for (let s = 0; s <= max; s++) future[s] = Math.max(0, ending - s) * step * shortageCost;
  const policy = slots.map(() => new Uint16Array(max + 1));
  for (let i = slots.length - 1; i >= 0; i--) {
    const q = slots[i], hours = (q.until - q.from) / 3600;
    const net = Math.max(0, q.houseW - q.pvW) / 1000;
    const surplus = Math.max(0, q.pvW - q.houseW) / 1000;
    const grid = q.ev === null || q.headroomW === null ? 0 : Math.min(chargeW, q.headroomW) / 1000;
    const up = Math.floor(Math.min(2.2, grid + surplus) * hours * etaC / step + 1e-8);
    const down = q.ev === false ? Math.floor(Math.min(net, dischargeW / 1000) * hours / etaD / step + 1e-8) : 0;
    const next = new Float64Array(max + 1); next.fill(Infinity);
    for (let s = floor; s <= max; s++) {
      // Hold wins ties, avoiding pointless cycling at flat/zero prices.
      let best = future[s] + net * hours * q.price, chosen = s;
      const low = Math.max(s < minimum ? s : minimum, s - down);
      for (let to = low; to <= Math.min(max, s + up); to++) {
        const delta = (to - s) * step, charged = Math.max(0, delta) / etaC;
        const delivered = Math.max(0, -delta) * etaD;
        const imported = Math.max(0, charged - surplus * hours);
        const cost = (net * hours + imported - delivered) * q.price + (charged + delivered) * wear + future[to];
        if (cost < best - 1e-8) { best = cost; chosen = to; }
      }
      next[s] = best; policy[i][s] = chosen;
    }
    future = next;
  }
  let state = initial;
  const intervals = slots.map((q, i) => {
    const to = policy[i][state], delta = (to - state) * step, hours = (q.until - q.from) / 3600;
    const powerW = Math.round(delta > 0 ? -delta / etaC / hours * 1000 : -delta * etaD / hours * 1000) || 0;
    const action = delta > 0 ? 'charge' : delta < 0 ? 'discharge' : 'hold';
    const result = {from:q.from, until:q.until, action, powerW, price:q.price,
      socFrom:state / 5, socTo:to / 5, ev:q.ev, sun:q.sun ?? null,
      reason:delta > 0 ? 'cheap-charge' : delta < 0 ? 'household-peak' : q.ev !== false ? 'ev-protection' : 'later-peak'};
    state = to; return result;
  });
  return {version:2, mode:'shadow', updatedAt:now, validUntil:Math.min(now + 600, slots.at(-1).until),
    capacityKwh:capacity, reservePercent:reserve, endReservePercent:terminal, topUpW:chargeW,
    inputQuality:input.inputQuality === 'calibrated' ? 'calibrated' : 'provisional',
    atRisk:state < ending, intervals};
}

// Final execution guard, independent of optimisation and smoothing. A planner
// proposal never authorises discharge into the car or an unknown EV state.
export function sessyTarget(plan, state, now) {
  const validNumber = v => typeof v === 'number' && Number.isFinite(v);
  if (!plan || plan.mode !== 'active' || plan.inputQuality !== 'calibrated' ||
      !validNumber(plan.updatedAt) || now < plan.updatedAt - 30 || now >= plan.validUntil ||
      now - plan.updatedAt > 600 || state.available !== true || state.fault !== false ||
      !validNumber(state.soc) || state.soc < 0 || state.soc > 100 ||
      !validNumber(state.houseNetW)) return 0;
  const q = plan.intervals.find(q => q.from <= now && q.until > now);
  if (!q) return 0;
  if (state.houseNetW < 0 && state.soc < 100) return -Math.round(Math.min(2200, -state.houseNetW));
  if (q.action === 'charge' && state.soc < 100 && typeof state.ev === 'boolean' && validNumber(state.headroomW)) {
    return -Math.floor(Math.max(0, Math.min(1000, -q.powerW, state.headroomW)));
  }
  if (q.action === 'discharge' && state.ev === false && state.soc > plan.reservePercent) {
    // The plan selects discharge periods; its forecast watts are not a live
    // ceiling. Follow measured household demand and replan from actual SoC.
    return Math.floor(Math.max(0, Math.min(1800, state.houseNetW)));
  }
  return 0;
}
