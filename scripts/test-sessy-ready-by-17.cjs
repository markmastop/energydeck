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
    plan: {id: 'plan', name: 'sessy_ready_by_17_plan', type: 'string', value: '{}'},
  });
  if ('enabled' in options) vars.enabled.value = options.enabled;
  if ('demand' in options) vars.demand.value = options.demand;
  if ('sun' in options) vars.sun = {id:'sun', name:'sessy_sunshine_forecast', type:'string', value:JSON.stringify(options.sun)};
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
  const sunshine = (instant, fraction=0) => {
    const epoch=Date.parse(instant)/1000, start=Math.floor(epoch/900)*900;
    return {version:1, valid:true, source:'open-meteo', updatedAt:epoch,
      periods:Array.from({length:13},(_,i)=>({start:start+i*900,end:start+(i+1)*900,sunMinutes:15*fraction}))};
  };
  const cloudy = await run(at('12:30'), {sun:sunshine(at('12:30'))});
  assert.equal(cloudy.result.targetW, -1000, 'A dark forecast starts top-up one hour earlier');
  assert.equal(JSON.parse(cloudy.vars.plan.value).sunAdvanceMinutes,60);
  const sunny = await run(at('12:30'), {sun:sunshine(at('12:30'),1)});
  assert.equal(sunny.result.targetW,0, 'Sunny forecast leaves room for actual solar until the safe latest start');
  const paused = await run(at('12:31'), {soc:55,vars:cloudy.vars,sun:sunshine(at('12:31'),1)});
  assert.equal(paused.result.targetW,0, 'A newly sunny forecast may pause an early top-up with deadline headroom');
  assert.equal((await run(at('13:29'),{sun:sunshine(at('13:29'),1)})).result.targetW,-1000,
    'An optimistic forecast never postpones the no-sun safety start');
  const stale=sunshine(at('12:30'));stale.updatedAt-=4501;
  assert.equal((await run(at('12:30'),{sun:stale})).result.targetW,0,'Stale forecast cannot advance charging');
  assert.equal((await run(at('12:30'),{sun:{...stale,updatedAt:Date.parse(at('12:30'))/1000,valid:false}})).result.targetW,0);
  const late=JSON.parse((await run(at('16:30'),{soc:99,sun:sunshine(at('16:30'),1)})).vars.plan.value);
  assert.equal(late.sunWindowMinutes,30,'Sunshine after 17:00 is excluded');
  assert.equal((await run(at('08:59'))).result.targetW, 600, 'Night/morning control is retained');
  assert.equal((await run(at('09:00'))).result.targetW, 0, 'Reserve starts at 09:00');
  assert.equal((await run(at('12:00'), {demand: -1800})).result.targetW, -200, 'Solar still charges');
  assert.equal((await run(at('10:40'), {soc: 0})).result.reason, 'solar-and-reserve');
  const empty = await run(at('10:42'), {soc: 0});
  assert.equal(empty.result.targetW, -1000, 'Empty battery gets a 6h19m planning window');
  assert.ok(empty.writes.indexOf('state') < empty.writes.indexOf('target'));
  const snapshot = JSON.parse(empty.vars.plan.value);
  assert.equal(snapshot.startMinute, 642);
  assert.equal(snapshot.topUpW, 1000);
  assert.equal(snapshot.deadlineMinute, 1020);
  assert.equal(snapshot.phase, 'grid-top-up');
  assert.equal((await run(at('13:28'), {soc: 50})).result.reason, 'solar-and-reserve');
  assert.equal((await run(at('13:29'), {soc: 50})).result.targetW, -1000);
  assert.equal((await run(at('15:08'), {soc: 80})).result.reason, 'solar-and-reserve',
    'A solar-filled battery postpones grid top-up');
  assert.equal((await run(at('15:09'), {soc: 80})).result.targetW, -1000);
  const latched = await run(at('13:30'), {soc: 55, vars: (await run(at('13:29'))).vars});
  assert.equal(latched.result.targetW, -1000, 'SoC increments must not cycle the top-up');
  assert.equal((await run(at('15:00'), {demand: -1800})).result.targetW, -1800,
    'Existing solar surplus remains available above the grid top-up rate');
  assert.equal((await run(at('15:00'), {demand: -5000})).result.targetW, -2200);
  assert.equal((await run(at('15:00'), {demand: -1800, limit: 1500})).result.targetW, -1500);
  assert.equal((await run(at('15:00'), {demand: 3000})).result.targetW, -1000,
    'Grid top-up must remain at 1 kW even with high household demand');
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
  assert.equal((await run('2026-03-29T15:00:00+02:00')).result.targetW, -1000, 'Spring DST uses local time');
  assert.equal((await run('2026-10-24T15:00:00+02:00')).result.targetW, -1000, 'Summer uses local time');
  for (const options of [{soc: -1}, {soc: 101}, {soc: '50'}, {fault: true}, {available: false}, {failDevice: true}, {limit: 900}]) {
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
      assert.ok(r.result.targetW >= -1000, 'No-sun top-up must never exceed 1 kW');
      if (r.result.targetW < 0) {
        firstCharge ??= minute;
        const input = Math.min(-r.result.targetW, soc >= 95 ? 500 : 2200);
        soc = Math.min(100, soc + input / 1000 / 60 * 0.9 / 5 * 100);
      }
    }
    assert.equal(soc, 100, `${initial}% starting SoC must reach full without sunlight`);
    if (initial < 100) assert.ok(firstCharge >= 10 * 60 + 42, 'Start in time for a 1 kW winter top-up');
    else assert.equal(firstCharge, null, 'A full battery must not be grid-charged');
  }
  // An entirely wrong sunny forecast must still meet the original no-sun goal.
  for(const fraction of [0,1]) {
    let soc=0, vars;
    for(let m=540;m<1020;m++) {
      const instant=at(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`);
      const r=await run(instant,{soc:Math.floor(soc+1e-8),vars,sun:sunshine(instant,fraction)});vars=r.vars;
      const input=Math.min(Math.max(0,-r.result.targetW),soc>=95?500:1000);
      soc=Math.min(100,soc+input/1000/60*.9/5*100);
    }
    assert.equal(soc,100,`No-sun completion despite a ${fraction?'wrong sunny':'dark'} forecast`);
  }
  console.log('PASS: Sessy solar priority, reserve, deadline, latch, full stop, disable, errors, DST, and five no-sun/taper day simulations');
})().catch(error => { console.error(error); process.exitCode = 1; });
