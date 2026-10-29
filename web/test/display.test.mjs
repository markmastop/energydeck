import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplayState, powerArc, dayComparison, createHomeCards } from '../public/display.js';
import { chargerState, normalize, configuration } from '../data.mjs';
import { createExtrasService } from '../extras.mjs';

const readings = () => ({ grid: { power: 500 }, gas: { rate: 0 }, solar: { power: 2200 },
  battery: { percentage: 65, power: -800 }, charger: { connected: true, charging: false, fault: false }, climate: { demand: 'idle' } });
const device = values => ({ capabilitiesObj: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) });
const config = configuration({ ENERGYDECK_WEB_ACCESS_CODE: '012345', HOMEY_ADDRESS: 'http://192.168.1.2', HOMEY_TOKEN: 'test', HOMEY_CHARGE_FLOW_ID: 'flow', HOMEY_CHARGER_DEVICE_ID: 'charger' });

test('ESP grid direction holds ten seconds and ignores near-zero noise', () => {
  const state = createDisplayState(), data = readings();
  assert.equal(state.update(data, 100).gridMode, 0);
  data.grid.power = -1000;
  assert.equal(state.update(data, 1000).gridMode, 0);
  assert.equal(state.update(data, 10999).gridPending, true);
  assert.equal(state.update(data, 11000).gridMode, 1);
  data.grid.power = 15;
  assert.equal(state.update(data, 12000).gridMode, 1);
  data.grid.power = null;
  assert.equal(state.update(data, 12001).gridMode, -1);
  data.grid.power = 800;
  assert.equal(state.update(data, 12002).gridMode, 0);
  state.reset();
  data.grid.power = -800;
  assert.equal(state.update(data, 12003).gridMode, 1);
});

test('ESP gas and solar/battery selection keep labels stable and drop missing sources immediately', () => {
  const state = createDisplayState(), data = readings();
  assert.equal(state.update(data, 100).gasMode, 0);
  assert.equal(state.update(data, 100).source, 0);
  data.gas.rate = .8; data.battery.power = 600;
  assert.equal(state.update(data, 1000).gasMode, 0);
  assert.equal(state.update(data, 10999).source, 0);
  assert.equal(state.update(data, 11000).gasMode, 1);
  assert.equal(state.update(data, 11000).source, 1);
  data.battery.percentage = null;
  assert.equal(state.update(data, 12000).source, 0);
  data.solar.power = null;
  assert.equal(state.update(data, 13000).source, -1);
  data.battery.percentage = 65; data.battery.power = 0;
  assert.equal(state.update(data, 14000).source, 1);
  data.gas.rate = null;
  assert.equal(state.update(data, 14000).gasMode, -1);
});

test('ESP status colors distinguish demand, charging, standby and unknown values', () => {
  const state = createDisplayState(), data = readings();
  let view = state.update(data, 0);
  assert.equal(view.heat, 'green'); assert.equal(view.car, 'blue'); assert.equal(view.battery, 'blue');
  data.climate.demand = 'demand'; data.charger.charging = true; data.battery.power = 500;
  view = state.update(data, 1);
  assert.equal(view.heat, 'orange'); assert.equal(view.car, 'orange'); assert.equal(view.battery, 'green');
  data.climate.demand = 'unknown'; data.charger.connected = false; data.battery.power = 25;
  view = state.update(data, 2);
  assert.equal(view.heat, 'dim'); assert.equal(view.car, 'dim'); assert.equal(view.battery, 'dim');
});

test('signed meter arcs use the ESP five-kilowatt half-scale and bounded values', () => {
  assert.equal(powerArc(-2500), -50); assert.equal(powerArc(2500), 50);
  assert.equal(powerArc(-25), -1); assert.equal(powerArc(25), 1);
  assert.equal(powerArc(-1), 0);
  assert.equal(powerArc(-12000), -100); assert.equal(powerArc(12000), 100);
  assert.equal(powerArc(null), 0); assert.equal(powerArc(NaN), 0);
});

test('tomorrow comparison uses full-day all-in averages and the ESP 0.05-cent threshold', () => {
  assert.equal(dayComparison(null, { average: 5 }), null);
  assert.equal(dayComparison({ average: 25 }, { average: 20 }).label, 'tomorrowCheaper');
  assert.equal(dayComparison({ average: 20 }, { average: 25 }).difference, 5);
  assert.equal(dayComparison({ average: 20 }, { average: 20.04 }).label, 'tomorrowEqual');
  assert.equal(dayComparison({ average: 20 }, { average: 20.06 }).label, 'tomorrowDearer');
});

test('charger matches ESP power-based activity and completed status without inventing missing telemetry', () => {
  const car = device({ measure_power: 51, is_connected: true, is_charging: false, alarm_device: false, status: 'charging_complete' });
  assert.equal(chargerState(car).charging, true); assert.equal(chargerState(car).complete, true);
  car.capabilitiesObj.measure_power.value = 50;
  assert.equal(chargerState(car).charging, false);
  delete car.capabilitiesObj.is_charging;
  assert.equal(chargerState(car).charging, null);
  car.available = false;
  assert.equal(chargerState(car).connected, null);
});

test('a lagging charger flag cannot authorize a duplicate start or reject a valid stop', async () => {
  let writes = 0;
  const service = createExtrasService(config, async (_, options) => {
    if (options.method === 'POST') { writes++; return Response.json({ ok: true }); }
    return Response.json(device({ measure_power: 7300, is_connected: true, is_charging: false, alarm_device: false }));
  }, () => new Date('2026-10-21T12:00:00Z'));
  await assert.rejects(service.charge({ confirm: true, target: true }), error => error.code === 'chargerNotReady');
  assert.equal(writes, 0);
  assert.equal((await service.charge({ confirm: true, target: false })).ok, true);
  assert.equal(writes, 1);
});

test('yesterday totals use actual summary capabilities and retain gaps when absent', () => {
  const result = normalize({ electricity: device({ meter_kwh_last_day: -2.5 }), solarDay: device({ meter_kwh_last_day: 12 }) }, [], null, config);
  assert.equal(result.grid.yesterday, -2.5); assert.equal(result.solar.yesterday, 12);
  assert.equal(normalize({}, [], null, config).grid.yesterday, null);
});


test('home cards prioritize Sonos, then Evohome demand, then Gas and retain manual choices between transitions', () => {
  const policy = createHomeCards();
  assert.equal(policy.update('climate', false, true, false), 'gas');
  assert.equal(policy.update('gas', false, true, true), 'climate');
  assert.equal(policy.update('climate', true, false, true), 'sonos');
  assert.equal(policy.update('gas', true, false, true), 'gas'); // Manual choice remains usable.
  assert.equal(policy.update('sonos', false, false, false), 'sonos'); // Unknown is not stopped.
  assert.equal(policy.update('sonos', false, true, true), 'climate');
  assert.equal(policy.update('climate', false, true, false), 'gas');
  policy.reset();
  assert.equal(policy.update('sonos', false, true, true), 'climate');
});


test('manual cards resume automatic priority at five idle minutes and new input restarts the wait', () => {
  const policy = createHomeCards();
  assert.equal(policy.update('gas', false, true, false), 'gas');
  assert.equal(policy.update('sonos', false, true, false, 299999), 'sonos');
  assert.equal(policy.update('sonos', false, true, false, 300000), 'gas');
  assert.equal(policy.update('climate', false, true, false, 0), 'climate');
  assert.equal(policy.update('gas', true, false, true, 300000), 'sonos');
  assert.equal(policy.update('gas', false, true, true, 300000), 'climate');
});

test('overview shows all nine rooms with heat demand first without altering the full room list', async()=>{
  const {overviewRooms}=await import('../public/display.js');
  const rooms=Array.from({length:9},(_,i)=>({name:String(i),temperature:i===7?18:20,target:20}));
  const selected=overviewRooms(rooms,{mode:'auto',demand:'demand'});
  assert.deepEqual(selected.map(r=>r.name),['7','0','1','2','3','4','5','6','8']);
  assert.equal(rooms.length,9);assert.equal(rooms[0].name,'0');
  assert.deepEqual(overviewRooms(rooms,{mode:'auto',demand:'off'}).map(r=>r.name),['0','1','2','3','4','5','6','7','8']);
  assert.deepEqual(overviewRooms([{name:'unknown',temperature:null,target:20},rooms[7]],{mode:'auto'}).map(r=>r.name),['7','unknown']);
});


test('header car is green for a fresh connected planned session; charging takes priority', () => {
  const data=readings(),state=createDisplayState(),now=Date.parse('2026-10-28T19:00:00Z');
  data.updatedAt=new Date(now).toISOString();
  data.prices={today:{date:'2026-10-28',values:Array(96).fill(30)},tomorrow:{date:'2026-10-29',values:Array(96).fill(20)}};
  assert.equal(state.update(data,now).car,'green');
  data.charger.charging=true;assert.equal(state.update(data,now).car,'orange');
  data.charger.charging=false;
  for (const override of [{complete:true},{fault:true},{charging:null},{connected:false}]) {
    const copy={...data,charger:{...data.charger,...override}};
    assert.equal(state.update(copy,now).car,override.connected===false?'dim':'blue');
  }
  assert.equal(state.update(data,now+46000).car,'blue');
  assert.equal(state.update({...data,prices:{}},now).car,'blue');
});
