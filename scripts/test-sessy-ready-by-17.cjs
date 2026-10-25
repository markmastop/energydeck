// Run the production HomeyScript with fake devices/Logic, never real commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../homeyscript/sessy-ready-by-17.js`, 'utf8');
async function run(local, options = {}) {
  const vars = structuredClone(options.vars || {
    target: {id: 'target', name: 'sessy_doel_vermogen', type: 'number', value: 600},
    demand: {id: 'demand', name: 'sessy_werkelijk_vermogen', type: 'number', value: 600},
    enabled: {id: 'enabled', name: 'sessy_ready_by_17_enabled', type: 'boolean', value: true},
    state: {id: 'state', name: 'sessy_ready_by_17_state', type: 'string', value: '{}'},
  });
  if ('enabled' in options) vars.enabled.value = options.enabled;
  if ('demand' in options) vars.demand.value = options.demand;
  const writes = [];
  const Homey = {
    logic: {
      async getVariables() { return structuredClone(vars); },
      async updateVariable({id, variable}) { vars[id].value = variable.value; writes.push(id); },
    },
    devices: {async getDevice() {
      if (options.failDevice) throw new Error('Offline');
      return {available: options.available ?? true, settings: {power_max_charge: options.limit ?? 2200},
        capabilitiesObj: {measure_battery: {value: options.soc ?? 50}, alarm_fault: {value: options.fault ?? false}}};
    }},
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [local])); } }
  const result = await vm.runInNewContext(`(async () => {${source}\n})()`, {Homey, Date: FixedDate, Intl});
  return {result, vars, writes};
}
(async () => {
  const date = '2026-10-25';
  const at = time => `${date}T${time}:00+01:00`;
  assert.equal((await run(at('08:59'))).result.targetW, 600, 'Night/morning control is retained');
  assert.equal((await run(at('09:00'))).result.targetW, 0, 'Reserve starts at 09:00');
  assert.equal((await run(at('12:00'), {demand: -1800})).result.targetW, -200, 'Solar still charges');
  assert.equal((await run(at('13:40'), {soc: 0})).result.reason, 'solar-and-reserve');
  const empty = await run(at('13:44'), {soc: 0});
  assert.equal(empty.result.targetW, -2200, 'Empty battery gets a 3h16m planning window');
  assert.ok(empty.writes.indexOf('state') < empty.writes.indexOf('target'));
  assert.equal((await run(at('14:58'), {soc: 50})).result.reason, 'solar-and-reserve');
  assert.equal((await run(at('15:00'), {soc: 50})).result.targetW, -2200);
  assert.equal((await run(at('15:10'), {soc: 80})).result.reason, 'solar-and-reserve',
    'A solar-filled battery postpones grid top-up');
  const latched = await run(at('15:01'), {soc: 55, vars: (await run(at('15:00'))).vars});
  assert.equal(latched.result.targetW, -2200, 'SoC increments must not cycle the top-up');
  const full = await run(at('15:02'), {soc: 100, vars: latched.vars});
  assert.equal(full.result.targetW, 0);
  assert.equal(full.result.reason, 'full-reserve');
  assert.equal(JSON.parse(full.vars.state.value).toppingUp, false);
  assert.equal((await run(at('17:00'), {vars: latched.vars})).result.targetW, 200,
    'Forced charging is removed immediately at the deadline, before normal smoothing');
  assert.equal((await run(at('16:00'), {enabled: false})).result.targetW, 600);
  assert.equal((await run(at('16:00'), {enabled: false, vars: latched.vars})).result.targetW, 200);
  const nextDay = await run('2026-10-26T12:00:00+01:00', {vars: latched.vars});
  assert.equal(nextDay.result.reason, 'solar-and-reserve', 'Yesterday cannot latch a new day');
  assert.equal(nextDay.result.targetW, 0, 'A missed stop cannot carry forced charging into tomorrow');
  assert.equal((await run('2026-03-29T15:00:00+02:00')).result.targetW, -2200, 'Spring DST uses local time');
  assert.equal((await run('2026-10-24T15:00:00+02:00')).result.targetW, -2200, 'Summer uses local time');
  for (const options of [{soc: -1}, {soc: 101}, {soc: '50'}, {fault: true}, {available: false}, {failDevice: true}, {limit: 1500}]) {
    await assert.rejects(() => run(at('16:00'), options));
  }
  // A no-sun day with 90% charging efficiency and 500 W taper for the final 5%.
  // Test the goal, rather than just matching arithmetic in the implementation.
  for (const initial of [0, 20, 50, 80, 100]) {
    let soc = initial, vars, firstCharge = null;
    for (let minute = 9 * 60; minute < 17 * 60; minute++) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      const r = await run(at(time), {soc: Math.floor(soc + 1e-8), vars});
      vars = r.vars;
      assert.ok(r.result.targetW <= 0, 'The day reserve must not discharge');
      if (r.result.targetW < 0) {
        firstCharge ??= minute;
        const input = Math.min(-r.result.targetW, soc >= 95 ? 500 : 2200);
        soc = Math.min(100, soc + input / 1000 / 60 * 0.9 / 5 * 100);
      }
    }
    assert.equal(soc, 100, `${initial}% starting SoC must reach full without sunlight`);
    if (initial < 100) assert.ok(firstCharge > 13 * 60, 'Leave the morning available for solar');
    else assert.equal(firstCharge, null, 'A full battery must not be grid-charged');
  }
  console.log('PASS: Sessy solar priority, reserve, deadline, latch, full stop, disable, errors, DST, and five no-sun/taper day simulations');
})().catch(error => { console.error(error); process.exitCode = 1; });
