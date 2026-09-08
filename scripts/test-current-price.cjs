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
  const repeat = await run('2026-09-08T00:14:30Z', payload, first.vars);
  assert.equal(repeat.writes.length, 0, 'Repeated checks must not retrigger unchanged flags');
  const boundary = await run('2026-09-08T00:15:00Z', payload, first.vars);
  assert.equal(boundary.value('Marktprijs EUR per kWh'), 0.01);
  const later = await run('2026-09-08T05:00:00Z', payload);
  assert.equal(later.value('Goedkoopste 7 uren'), false);
  const rollover = await run('2026-09-07T22:00:00Z', {...payload, today:{date:'2026-09-07', values:Array(96).fill(99)}, tomorrow:payload.today});
  assert.equal(rollover.value('Marktprijs EUR per kWh'), -0.08);
  const ties = await run('2026-09-08T01:00:00Z', {...payload, today:{date:day, values:Array(96).fill(0)}});
  assert.equal(ties.value('Goedkoopste 3 uren'), false, 'Equal-price hours use chronological tie breaking');
  for (const bad of ['{', {}, {...payload, today:{date:'2026-09-07',values:Array(96).fill(1)}}, {...payload,today:{date:day,values:[null]}}]) {
    const r = await run('2026-09-08T00:15:00Z', bad, first.vars);
    assert.equal(r.result.ok, false);
    assert.equal(r.value('Prijzen geldig'), false);
    assert.equal(r.value('Goedkoopste 3 uren'), false);
    assert.equal(r.value('Goedkoopste 7 uren'), false);
    assert.equal(r.value('Marktprijs EUR per kWh'), 0, 'Last numeric price retained but invalidated');
  }
  for (const dst of ['2026-03-29','2026-10-25']) {
    const r = await run(dst+'T12:00:00Z', {today:{date:dst, values:Array(96).fill(0.1)}});
    assert.equal(r.result.ok,false);
    assert.match(r.result.reason,/wintertijd/);
  }
  console.log('PASS: current quarters, negative/zero prices, ranking, unchanged flags, midnight, invalid cache and DST');
})().catch(error => {console.error(error); process.exitCode = 1;});
