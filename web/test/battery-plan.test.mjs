import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryPlan, batteryPlanView, planClock} from '../public/battery-plan.js';
import {configuration, createDataService} from '../data.mjs';
import {forwardBatteryPlan, forwardClock} from '../public/battery-plan.js';

const now = new Date('2026-10-25T12:30:00Z');
const plan = {version: 1, day: '2026-10-25', updatedAt: now.getTime()/1000,
  enabled: true, phase: 'solar-and-reserve', capacityKwh: 5, topUpW: 1000,
  targetPercent: 100, reserveMinute: 540, deadlineMinute: 1020, startMinute: 809};

const epoch=now.getTime()/1000;
const forward={version:2,mode:'shadow',inputQuality:'provisional',updatedAt:epoch,validUntil:epoch+600,
  capacityKwh:5,topUpW:1000,reservePercent:10,endReservePercent:20,atRisk:false,
  intervals:[{from:epoch,until:epoch+900,action:'charge',powerW:-1000,price:15,socFrom:50,socTo:54.5,ev:true,sun:.5},
    {from:epoch+900,until:epoch+1800,action:'discharge',powerW:500,price:50,socFrom:54.5,socTo:52,ev:false,sun:null}]};

test('forward proposal keeps sunshine separate, next action and measured-vs-predicted data explicit',()=>{
  const parsed=batteryPlan({...plan,forwardPlan:forward},now);
  assert.equal(parsed.version,2);assert.equal(parsed.mode,'shadow');assert.equal(parsed.inputQuality,'provisional');
  const view=batteryPlanView(parsed,now);
  assert.equal(view.current.action,'charge');assert.equal(view.next.action,'discharge');
  assert.equal(view.phases.length,2);assert.equal(view.sunshine.length,1);assert.equal(view.sunshine[0].fraction,.5);
  assert.equal(forwardClock(epoch,now,'nl'),'13:30');
  assert.match(forwardClock(epoch+86400,now,'nl'),/26/);
});

test('stale/manual, unsafe EV, unknown actions and incomplete forward intervals fall back safely',()=>{
  for(const bad of [{...forward,validUntil:epoch},{...forward,updatedAt:epoch-601},
    {...forward,intervals:[{...forward.intervals[0],action:'discharge',powerW:100}]},
    {...forward,intervals:[{...forward.intervals[0],sun:2}]},
    {...forward,intervals:[forward.intervals[0],{...forward.intervals[1],from:epoch+901}]}]) {
    assert.equal(forwardBatteryPlan(bad,now),null);
    assert.equal(batteryPlan({...plan,forwardPlan:bad},now).version,1);
  }
  assert.equal(batteryPlan({...plan,updatedAt:epoch-181,forwardPlan:forward},now),null,'A fresh proposal cannot revive a stopped normal-control envelope');
  const envelope=batteryPlan({...plan,forwardPlan:forward},now);
  assert.equal(batteryPlan(envelope,new Date((epoch+181)*1000)),null,'Normalised v2 must retain manual-control expiry');
});

test('charge plan uses controller values and actual Amsterdam/DST time', () => {
  const view = batteryPlanView(JSON.stringify(plan), now);
  assert.equal(view.label, 'batteryPlanSolar');
  assert.equal(planClock(view.plan.startMinute), '13:29');
  assert.equal(view.now, 56.25); // 13:30 local, after the autumn clock change.
  assert.ok(view.start > 56 && view.start < 57);
  assert.equal(batteryPlanView({...plan, phase:'grid-top-up'}, now).label, 'batteryPlanTopup');
  assert.equal(batteryPlanView({...plan, enabled:false}, now).label, 'batteryPlanOff');
  assert.equal(batteryPlanView({...plan, phase:'full-reserve', startMinute:null}, now).label, 'batteryPlanReserve');
});

test('stopped/manual controller, midnight, invalid and future plans are never shown as current', () => {
  assert.ok(batteryPlan({...plan, updatedAt: plan.updatedAt - 180}, now));
  for (const bad of [null, '{', {...plan, day:'2026-10-24'}, {...plan, updatedAt:plan.updatedAt-181},
    {...plan, updatedAt:plan.updatedAt+31}, {...plan, topUpW:'1000'}, {...plan, capacityKwh:NaN},
    {...plan, targetPercent:90}, {...plan, startMinute:1050}, {...plan, deadlineMinute:500},
    {...plan, phase:'assumed-charging'}, {...plan, enabled:1}]) {
    assert.equal(batteryPlan(bad, now), null);
    assert.equal(batteryPlanView(bad, now).label, 'batteryPlanUnavailable');
  }
});

test('sunshine is optional and invalid forecast detail does not hide a valid safe plan', () => {
  const sunny = batteryPlan({...plan, sunMinutes:11, sunWindowMinutes:180, sunAdvanceMinutes:53}, now);
  assert.equal(sunny.sunMinutes,11);
  assert.equal(sunny.sunAdvanceMinutes,53);
  assert.equal(batteryPlan(plan,now).sunMinutes,null,'Older controller snapshots remain readable');
  const bad = batteryPlan({...plan, sunMinutes:190, sunWindowMinutes:180},now);
  assert.equal(bad.startMinute,809);
  assert.equal(bad.sunMinutes,null);
});

test('plan fetch is restricted, private, and independent from live battery availability', async () => {
  const config = configuration({ENERGYDECK_WEB_ACCESS_CODE:'012345', HOMEY_ADDRESS:'http://homey.test',
    HOMEY_TOKEN:'secret-test-token', HOMEY_SESSY_DEVICE_ID:'battery', HOMEY_BATTERY_PLAN_VARIABLE_ID:'plan'});
  const paths = [];
  const service = createDataService(config, async (url, options) => {
    paths.push(url); assert.equal(options.headers.Authorization, 'Bearer secret-test-token');
    return Response.json(url.endsWith('/plan') ? {value:JSON.stringify(plan)} :
      {capabilitiesObj:{measure_battery:{value:50}, 'measure_power.battery':{value:-1000}}});
  }, () => now);
  const result = await service.get();
  assert.equal(result.battery.plan.startMinute, 809);
  assert.equal(result.battery.percentage, 50);
  assert.equal(paths.length, 2);
  assert.equal(JSON.stringify(result).includes('secret-test-token'), false);
});

test('sunshine quarters share the charge-plan axis and reject malformed optional data', () => {
  const forecast = {...plan, sunMinutes:15, sunWindowMinutes:30, sunPeriods:[
    {from:795, until:810, fraction:0}, {from:810, until:825, fraction:1}]};
  const view = batteryPlanView(forecast, now); // 13:30 local: first interval is past.
  assert.equal(view.sunshine.length,1);
  assert.equal(view.sunshine[0].left,56.25);
  assert.equal(view.sunshine[0].width,3.125);
  assert.equal(view.sunshine[0].fraction,1);
  for (const bad of [[{from:1000,until:1030,fraction:1}], [{from:810,until:825,fraction:2}],
      [{from:795,until:810,fraction:0},{from:811,until:825,fraction:1}], Array(17).fill({from:810,until:825,fraction:1}), [null]]) {
    const parsed = batteryPlan({...forecast,sunPeriods:bad},now);
    assert.deepEqual(parsed.sunPeriods,[]);
    assert.equal(parsed.startMinute,809,'Invalid sunshine must retain the charging plan');
  }
});
