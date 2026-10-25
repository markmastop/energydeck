import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSessyProfile,sessyLiveState,executeSessyPlan} from '../homeyscript/sessy-measured-inputs.mjs';
const epoch=Date.parse('2026-10-25T13:00:00Z')/1000;
const logs={};
for (const [key,value] of Object.entries({grid:2500,battery:-500,pv:1000,ev:3000,phase:1000})) {
  logs[key]={values:Array.from({length:168},(_,i)=>({t:new Date((epoch-168*3600+i*3600)*1000).toISOString(),v:value}))};
}
const p=buildSessyProfile(logs,epoch);
assert.equal(p.samples,168);assert.ok(p.bins.flat().every(b=>b.houseW===1000));
assert.ok(p.bins.flat().every(b=>b.evW===3000&&b.phaseW===500));
assert.throws(()=>buildSessyProfile({...logs,ev:{values:[]}},epoch),/Insufficient/);
const cap=value=>({value,lastUpdated:epoch*1000});
const config={version:1,phases:3,fuseA:25,phase:3,marginA:2,wearCt:1.5};
const battery={available:true,settings:{power_max_charge:2200,power_max_discharge:1800},capabilitiesObj:{
  measure_power:cap(-500),measure_battery:cap(50),alarm_fault:cap(false),override:cap(false),control_strategy:cap('POWER_STRATEGY_API'),meter_setpoint:cap(500)}};
const grid={available:true,capabilitiesObj:{measure_power:cap(500),'measure_voltage.l3':cap(230),'measure_current.l3':cap(10),'measure_power.l3':cap(2300)}};
const charger={available:true,capabilitiesObj:{measure_power:{value:0,lastUpdated:1},is_charging:{value:false,lastUpdated:1},alarm_device:cap(false),measure_voltage:cap(390)}};
let state=sessyLiveState(battery,grid,charger,config,epoch);
assert.equal(state.houseNetW,1000);assert.equal(state.headroomW,2490);assert.equal(state.ev,false,'Unchanged zero is valid with a live voltage heartbeat');
let plan={mode:'active',inputQuality:'calibrated',updatedAt:epoch,validUntil:epoch+600,reservePercent:10,
  intervals:[{from:epoch,until:epoch+900,action:'discharge',powerW:1500}]};
assert.equal(executeSessyPlan(plan,state,epoch).targetW,1000,'No export and no smoothing overshoot');
assert.equal(executeSessyPlan({...plan,intervals:[{...plan.intervals[0],powerW:200}]},state,epoch).targetW,1000,'Forecast power cannot cap household-following discharge');
assert.equal(executeSessyPlan(plan,{...state,houseNetW:4000},epoch).targetW,1800);
assert.equal(executeSessyPlan(plan,{...state,houseNetW:1600,dischargeLimitW:1200},epoch).targetW,1200);
assert.equal(executeSessyPlan(plan,{...state,ev:true},epoch).targetW,0);
assert.equal(executeSessyPlan(plan,{...state,ev:true},epoch).reason,'ev-charging');
for(const changed of [{ev:null},{available:false},{fault:true},{manual:true},{soc:10}]) assert.equal(executeSessyPlan(plan,{...state,...changed},epoch).targetW,0);
assert.equal(executeSessyPlan(plan,{...state,soc:101},epoch).reason,'battery-unavailable');
assert.equal(executeSessyPlan(plan,state,epoch+600).reason,'plan-unavailable');
plan.intervals[0]={...plan.intervals[0],action:'charge',powerW:-1000};
assert.equal(executeSessyPlan(plan,{...state,headroomW:230,ev:true},epoch).targetW,-230);
assert.equal(executeSessyPlan(plan,{...state,headroomW:230,ev:true},epoch).reason,'phase-limit');
assert.equal(executeSessyPlan(plan,{...state,headroomW:null},epoch).targetW,0);
assert.equal(executeSessyPlan(plan,{...state,houseNetW:-2000,headroomW:2400},epoch).targetW,-2000);
assert.equal(executeSessyPlan(plan,{...state,houseNetW:-2000,headroomW:800},epoch).targetW,-800);
assert.equal(sessyLiveState(battery,grid,charger,{...config,phase:null},epoch).headroomW,null);
charger.capabilitiesObj.measure_voltage.lastUpdated=(epoch-70)*1000;
assert.equal(sessyLiveState(battery,grid,charger,config,epoch).ev,null);
charger.capabilitiesObj.measure_voltage.lastUpdated=epoch*1000;
const idle=structuredClone(battery);
idle.capabilitiesObj.measure_power={value:0,lastUpdated:(epoch-3600)*1000};
idle.capabilitiesObj.measure_frequency=cap(50);
assert.equal(sessyLiveState(idle,grid,charger,config,epoch).available,true,'A stable zero is valid with an independent battery heartbeat');
idle.capabilitiesObj.measure_frequency.lastUpdated=(epoch-70)*1000;
assert.equal(sessyLiveState(idle,grid,charger,config,epoch).available,false,'A stale independent heartbeat still stops control');

// stdin is the installer's exact named bundle. Replay preview/control without
// providing a Flow API or a device-command API; compare final target writes.
const source=fs.readFileSync(0,'utf8');
if(source) {
  charger.capabilitiesObj.measure_voltage.lastUpdated=epoch*1000;
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[epoch*1000]));}}
  const bridge={today:{date:'2026-10-25',source:'homey',values:Array(100).fill(.01)},tomorrow:{date:'2026-10-26',source:'homey',values:Array(96).fill(.20)}};
  const vars=Object.fromEntries([
    ['enabled','sessy_price_plan_enabled','boolean',false],['config','sessy_price_config','string',JSON.stringify(config)],
    ['profile','sessy_price_profile','string',JSON.stringify(p)],['target','sessy_doel_vermogen','number',600],
    ['saved','sessy_ready_by_17_state','string','{}'],['plan','sessy_ready_by_17_plan','string','{}'],
    ['prices','bridge','string',JSON.stringify(bridge)],
  ].map(([id,name,type,value])=>[id,{id,name,type,value}]));
  async function run(mode, overrides={}) {
    const variables=structuredClone(vars),writes=[];
    if(mode==='control')variables.enabled.value=true;
    const Homey={logic:{getVariables:async()=>variables,updateVariable:async({id,variable})=>{writes.push({id,value:variable.value});variables[id].value=variable.value;}},
      devices:{getDevice:async({id})=>structuredClone(({battery,grid,charger,...overrides})[id])},
      insights:{getLogEntries:async()=>{throw new Error('Cached profile should not fetch history');}}};
    const out=await vm.runInNewContext(`(async()=>{${source}\n})()`,{Homey,args:[mode],Date:FixedDate,Intl,Math,JSON});
    return {out,writes,variables};
  }
  const preview=await run('preview-active');assert.equal(preview.writes.length,0);assert.equal(preview.out.proposal.mode,'active');
  assert.equal(preview.out.proposal.inputQuality,'calibrated');assert.ok(preview.out.proposal.quarters>90);
  const disabled=await run('preview');assert.equal(disabled.out.controller.targetW,0);assert.equal(disabled.out.proposal,null);
  const control=await run('control');assert.deepEqual(control.writes.map(w=>w.id),['saved','target','plan']);
  const snapshot=JSON.parse(control.variables.plan.value);
  assert.equal(snapshot.forwardPlan.mode,'active');assert.equal(snapshot.execution.targetW,control.out.targetW);
  assert.equal(snapshot.forwardPlan.inputs.wearCt,1.5,'The selected allowance reaches the exact installed controller');
  const ev=structuredClone(charger);ev.capabilitiesObj.is_charging.value=true;ev.capabilitiesObj.measure_power.value=11000;
  const withEv=await run('control',{charger:ev});assert.ok(withEv.out.targetW<=0,'Never discharge into an active EV');
  assert.ok(JSON.stringify(control.variables.plan.value).length<65536);
}
console.log('PASS: measured reconstruction, profile gaps, phase VA/restored battery load, EV heartbeat, reserve/fault/stale/manual guards, solar, exact active bundle and zero-write preview');
