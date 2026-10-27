// Exercise the actual HomeyScript against isolated Logic variables. No real Flows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../homeyscript/energie-actuele-prijs.js'), 'utf8');
async function run(instant, payload, existing = {}) {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const vars = structuredClone(existing), writes = [];
  vars.cache = {id: 'cache', name: 'EnergyDeck Prices', type: 'string', value: typeof payload === 'string' ? payload : JSON.stringify(payload)};
  const Homey = {logic: {
    async getVariables() { return structuredClone(vars); },
    async updateVariable({id, variable}) { Object.assign(vars[id], variable); writes.push(vars[id].name); },
    async createVariable({variable}) { const id = variable.name; vars[id] = {...variable, id}; writes.push(id); },
  }};
  const result = await vm.runInNewContext(`(async () => {${source}\n})()`, {Homey, Date: FixedDate, Intl});
  const value = name => Object.values(vars).find(v => v.name === 'Energie - ' + name)?.value;
  return {result, vars, writes, value};
}
(async () => {
  const day = '2026-09-08';
  const payload = {today: {date: day, values: Array.from({length:96}, (_,i) => (i-8)/100)},
    sources: {[day]: 'EpexPrijzen.nl (raw EUR/kWh)'}, homeyAvailable: {[day]:false}, updatedAt: '2026-09-08T00:00:00Z'};
  const first = await run('2026-09-08T00:14:00Z', payload); // 02:14 Amsterdam
  assert.equal(first.result.quarter, 8);
  assert.equal(first.value('Marktprijs EUR per kWh'), 0);
  assert.equal(first.value('Goedkoopste 3 uren'), true);
  assert.equal(first.value('Goedkoopste 7 uren'), true);
  assert.equal(first.value('Homey prijzen beschikbaar'), false);
  assert.equal(first.value('Prijzen geldig'), true);
  assert.match(first.value('Dashboardprijs'), /^⚠ \| 13,1 ct/);
  assert.equal(first.value('Dashboardcategorie'), 'C');
  assert.ok(first.writes.indexOf('Energie - Dashboardcategorie') < first.writes.indexOf('Energie - Dashboardprijs'));
  assert.ok(!first.writes.some(n => ['kwh_prijs', 'kwh_prijs_categorie', 'kwh_prijs_hoog', 'sessy_status'].includes(n)));
  assert.equal(first.writes.at(-1), 'Energie - Prijsupdate');
  assert.ok(first.writes.indexOf('Energie - Prijsinterval') > first.writes.indexOf('Energie - Goedkoopste 7 uren'));
  assert.equal(JSON.parse(first.value('Prijsupdate')).valid, true);
  const repeat = await run('2026-09-08T00:14:30Z', payload, first.vars);
  assert.equal(repeat.writes.length, 0, 'Repeated checks must not retrigger unchanged flags');
  const boundary = await run('2026-09-08T00:15:00Z', payload, first.vars);
  assert.equal(boundary.value('Marktprijs EUR per kWh'), 0.01);
  assert.match(boundary.value('Dashboardprijs'), /^⚠ \| 14,3 ct/);
  const screenshotPayload = {...payload, today:{date:day, values:Array(96).fill(0.061)}};
  const screenshot = await run('2026-09-08T00:14:00Z', screenshotPayload);
  assert.match(screenshot.value('Dashboardprijs'), /^⚠ \| 20,5 ct \| gem. 20,5/);
  assert.equal(screenshot.value('Marktprijs EUR per kWh'), 0.061);
  const homeyPayload = {...payload, sources: {[day]: 'Homey'}};
  const switched = await run('2026-09-08T00:14:30Z', homeyPayload, first.vars);
  assert.match(switched.value('Dashboardprijs'), /Homey/);
  assert.ok(switched.writes.includes('Energie - Dashboardprijs'));
  assert.equal(switched.value('Prijsupdate'), first.value('Prijsupdate'), 'Source-only changes must not retrigger charging');
  const correctedPayload = structuredClone(payload);
  correctedPayload.today.values[8] = 1.5;
  const corrected = await run('2026-09-08T00:14:30Z', correctedPayload, first.vars);
  assert.equal(corrected.value('Prijsinterval'), first.value('Prijsinterval'));
  assert.notEqual(corrected.value('Prijsupdate'), first.value('Prijsupdate'));
  assert.equal(corrected.writes.at(-1), 'Energie - Prijsupdate');
  const later = await run('2026-09-08T05:00:00Z', payload);
  assert.equal(later.value('Goedkoopste 7 uren'), false);
  const rollover = await run('2026-09-07T22:00:00Z', {...payload, today:{date:'2026-09-07', values:Array(96).fill(99)}, tomorrow:payload.today});
  assert.equal(rollover.value('Marktprijs EUR per kWh'), -0.08);
  assert.match(rollover.value('Dashboardprijs'), /3,4 ct/);
  const ties = await run('2026-09-08T01:00:00Z', {...payload, today:{date:day, values:Array(96).fill(0)}});
  assert.equal(ties.value('Goedkoopste 3 uren'), false, 'Equal-price hours use chronological tie breaking');
  assert.equal(ties.value('Dashboardcategorie'), 'C', 'Match the deck minimum-span rule for flat days');
  // Tomorrow may change the rolling chart classification without changing charging signals.
  const rollingToday = Array(96).fill(0.2); rollingToday[0] = -1; rollingToday[95] = 0.3;
  const rollingPayload = {today:{date:day,values:rollingToday},tomorrow:{date:'2026-09-09',values:Array(96).fill(1)}};
  const rolling = await run('2026-09-08T13:00:00Z', rollingPayload);
  assert.equal(rolling.value('Dashboardcategorie'), 'C');
  assert.equal(rolling.value('Dashboardadvies'), 'Nu apparaten gebruiken');
  const missingTomorrow = await run('2026-09-08T13:00:00Z', {...rollingPayload,tomorrow:{}}, rolling.vars);
  assert.equal(missingTomorrow.value('Dashboardcategorie'), 'E');
  assert.equal(missingTomorrow.value('Dashboardadvies'), 'Beperk energiegebruik');
  assert.equal(missingTomorrow.value('Prijsupdate'), rolling.value('Prijsupdate'));
  const three = Array(96).fill(0.5); three[0]=0; three[95]=1;
  for (const [value, expected] of [[0.329,'C'],[0.331,'N'],[0.659,'N'],[0.661,'E']]) {
    three[8]=value;
    const r=await run('2026-09-08T00:14:00Z',{today:{date:day,values:three}});
    assert.equal(r.value('Dashboardcategorie'),expected);
  }
  for (const bad of ['{', {}, {...payload, today:{date:'2026-09-07',values:Array(96).fill(1)}}, {...payload,today:{date:day,values:[null]}}]) {
    const r = await run('2026-09-08T00:15:00Z', bad, first.vars);
    assert.equal(r.result.ok, false);
    assert.equal(r.value('Prijzen geldig'), false);
    assert.match(r.value('Dashboardprijs'), /^⚠ Geen geldige prijzen/);
    assert.equal(r.value('Dashboardadvies'), '⚠ Geen geldige prijzen');
    assert.ok(!r.value('Dashboardprijs').includes('€/kWh'));
    assert.equal(r.value('Dashboardcategorie'), 'N');
    assert.equal(r.writes.at(-1), 'Energie - Prijsupdate');
    assert.equal(JSON.parse(r.value('Prijsupdate')).valid, false);
    assert.equal(r.value('Goedkoopste 3 uren'), false);
    assert.equal(r.value('Goedkoopste 7 uren'), false);
    assert.equal(r.value('Marktprijs EUR per kWh'), 0, 'Last numeric price retained but invalidated');
  }
  for (const dst of ['2026-03-29','2026-10-25']) {
    const r = await run(dst+'T12:00:00Z', {today:{date:dst, values:Array(96).fill(0.1)}});
    assert.equal(r.result.ok,false);
    assert.match(r.result.reason,/volledige geldige prijzen/);
  }
  for (const [date, start, count] of [['2026-03-29','2026-03-28T23:00:00Z',92], ['2026-10-25','2026-10-24T22:00:00Z',100]]) {
    const values = Array.from({length:count},(_,i) => i/1000);
    for (const quarter of [0,8,12,count-1]) {
      const instant = new Date(Date.parse(start)+quarter*900000).toISOString();
      const r = await run(instant, {today:{date,values}});
      assert.equal(r.result.ok,true);
      assert.equal(r.result.quarter,quarter);
      assert.equal(r.value('Marktprijs EUR per kWh'),values[quarter]);
      assert.equal(r.value('Goedkoopste 3 uren'),quarter<12);
    }
  }
  const repeated = {today:{date:'2026-10-25',values:Array.from({length:100},(_,i)=>i)}};
  const firstHour = await run('2026-10-25T00:00:00Z',repeated);
  const secondHour = await run('2026-10-25T01:00:00Z',repeated,firstHour.vars);
  assert.notEqual(firstHour.value('Prijsinterval'),secondHour.value('Prijsinterval'));
  assert.notEqual(firstHour.value('Prijsupdate'),secondHour.value('Prijsupdate'));
  const {evChargingPlan, evChargingState} = await import('../web/public/ev-plan.js');
  const {priceDayBounds} = await import('../web/public/charts.js');
  const shared = fs.readFileSync(path.join(__dirname, '../web/public/ev-plan.js'), 'utf8')
    .split('export function evChargingPlan')[1].split('// Record only quarters')[0];
  assert.ok(source.includes(('function evChargingPlan' + shared).replaceAll('export function','function').replaceAll('priceDayBounds','dayBounds')),
    'The Homey policy must remain identical to the client planner');
  for (const date of ['2026-10-27','2026-03-29','2026-10-25']) {
    const bounds = priceDayBounds(date), next = new Date(bounds.end + 43200000).toISOString().slice(0,10);
    const evPayload = {today:{date,values:Array.from({length:bounds.count},(_,i)=>(i*13)%31-5)},
      tomorrow:{date:next,values:Array.from({length:priceDayBounds(next).count},(_,i)=>(i*7)%29)}};
    const plan = evChargingPlan([evPayload.today,evPayload.tomorrow]);
    for (let q=0;q<bounds.count;q++) {
      const at=bounds.start+q*900000, expected=evChargingState(plan,at/1000).state==='allow';
      const r=await run(new Date(at).toISOString(),evPayload);
      assert.equal(r.value('EV zesuursplan toegestaan'),expected,`${date} quarter ${q}`);
      assert.equal(JSON.parse(r.value('Prijsupdate')).evSixHourAllowed,expected);
      assert.ok(r.writes.indexOf('Energie - EV zesuursplan toegestaan')<r.writes.indexOf('Energie - Prijsupdate'));
    }
  }
  const invalidEv=await run('2026-09-08T00:15:00Z',{},first.vars);
  assert.equal(invalidEv.value('EV zesuursplan toegestaan'),false);
  assert.equal(JSON.parse(invalidEv.value('EV zesuursplan')).state,'unknown');
  assert.ok(!invalidEv.writes.includes('Laden_Forceren'));
  console.log('PASS: EV permission matches every client quarter on regular and both DST days; invalid prices disable automatic permission');
  console.log('PASS: current quarters, negative/zero prices, ranking, unchanged flags, midnight, invalid cache and DST');
})().catch(error => {console.error(error); process.exitCode = 1;});
