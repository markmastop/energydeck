// Execute the exact installed named script against fake APIs, never live commands.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(0, 'utf8');
const epoch = Date.parse('2026-10-25T13:00:00Z') / 1000;
class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [epoch * 1000])); } }
const bridge = {today: {date:'2026-10-25', source:'homey', values:Array(100).fill(.01)},
  tomorrow:{date:'2026-10-26', source:'epexprijzen', values:Array(96).fill(.1)}};
const initial = Object.fromEntries([
  ['target','sessy_doel_vermogen','number',600], ['demand','sessy_werkelijk_vermogen','number',600],
  ['enabled','sessy_ready_by_17_enabled','boolean',true], ['state','sessy_ready_by_17_state','string','{}'],
  ['plan','sessy_ready_by_17_plan','string','{}'], ['prices','price-bridge','string',JSON.stringify(bridge)],
].map(([id,name,type,value]) => [id,{id,name,type,value}]));
async function run(args, input = initial, fail = false) {
  const variables = structuredClone(input), writes = [], reads = [];
  const Homey = {
    logic: {async getVariables() { reads.push('variables'); return structuredClone(variables); },
      async updateVariable({id,variable}) { writes.push({id,value:variable.value}); variables[id].value=variable.value; }},
    devices: {async getDevice({id}) {
      reads.push(id); if (fail) throw new Error('Offline');
      if (id === 'battery') return {available:true,settings:{power_max_charge:2200},
        capabilitiesObj:{measure_battery:{value:50},alarm_fault:{value:false}}};
      assert.equal(id,'charger'); return {available:true,capabilitiesObj:{measure_power:{value:0},
        is_charging:{value:false},alarm_device:{value:false}}};
    }},
  };
  const context = {Homey,Intl,Date:FixedDate,Math,JSON};
  if (args !== undefined) context.args = args;
  const result = await vm.runInNewContext(`(async () => {${source}\n})()`, context);
  return {result,writes,variables,reads};
}
(async () => {
  for (const args of [undefined, [], ['preview']]) {
    const tested=await run(args);
    assert.equal(tested.result.preview,true); assert.equal(tested.result.writesApplied,0);
    assert.equal(tested.writes.length,0,'Manual test must not update latch, target or plan freshness');
    assert.deepEqual(tested.variables,initial);
    assert.equal(tested.result.controller.targetW,-1000);
    assert.equal(tested.result.proposal.mode,'shadow');
    assert.ok(tested.result.proposal.quarters>90);
    assert.ok(tested.result.proposal.phases.some(p=>p.action==='charge'));
    assert.equal(tested.result.proposal.phases[0].priceMin,(1+9.161)*1.21+2);
  }
  const controlled=await run(['control']);
  assert.deepEqual(controlled.writes.map(w=>w.id),['state','target','plan']);
  assert.equal(controlled.result.targetW,-1000);
  assert.equal(JSON.parse(controlled.variables.plan.value).forwardPlan.mode,'shadow');
  const again=await run([],controlled.variables);
  assert.equal(again.writes.length,0); assert.ok(again.result.proposal.quarters>90,'An unchanged snapshot still has a preview');
  for (const args of [['CONTROL'],['control','extra'],[''],['publish']]) await assert.rejects(run(args),/Use no argument/);
  await assert.rejects(run([],initial,true),/Offline/);
  const noPrices=structuredClone(initial);delete noPrices.prices;
  const fallback=await run([],noPrices);
  assert.equal(fallback.result.proposal,null); assert.equal(fallback.writes.length,0);
  console.log('PASS: exact named script; manual/default preview makes zero writes; explicit control preserves write order, shadow mode, tariffs and failures');
})().catch(error=>{console.error(error);process.exitCode=1;});
