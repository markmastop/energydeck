import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryPlan, batteryPlanView, planClock} from '../public/battery-plan.js';
import {configuration, createDataService} from '../data.mjs';

const now = new Date('2026-10-25T12:30:00Z');
const plan = {version: 1, day: '2026-10-25', updatedAt: now.getTime()/1000,
  enabled: true, phase: 'solar-and-reserve', capacityKwh: 5, topUpW: 1000,
  targetPercent: 100, reserveMinute: 540, deadlineMinute: 1020, startMinute: 809};

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
