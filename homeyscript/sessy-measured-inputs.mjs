import {sessyTarget, sessyChargeWindow} from './sessy-price-planner.mjs';
// Pure input model. Homey energy_power is signed AC consumption for grid/battery
// and positive production for PV. Reconstruct gross house load excluding the EV.
export function buildSessyProfile(logs, now) {
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const map = points => new Map((points?.values || []).filter(p => finite(p.v))
    .map(p => [Date.parse(p.t) / 1000, p.v]));
  const series = Object.fromEntries(['grid','battery','pv','ev','phase'].map(k => [k,map(logs[k])]));
  const rows = [];
  const calendar = epoch => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23',weekday:'short',
  }).formatToParts(new Date(epoch*1000)).map(p => [p.type,p.value]));
  for (const [at,grid] of series.grid) {
    if (!Number.isInteger(at) || at > now-3600 || at < now-8*86400) continue;
    const [battery,pv,ev,phase] = ['battery','pv','ev','phase'].map(k => series[k].get(at));
    if (![battery,pv,ev,phase].every(finite) || ev < 0 || pv < -20) continue;
    const house = grid-battery+Math.max(0,pv)-ev;
    if (house < -300 || house > 30000) continue;
    const c=calendar(at);
    rows.push({at,hour:Number(c.hour),weekend:['Sat','Sun'].includes(c.weekday),
      house:Math.max(0,house),ev,phase:Math.max(0,phase-battery-ev/3)});
  }
  if (rows.length < 72 || Math.max(...rows.map(p=>p.at)) < now-10800) throw new Error('Insufficient recent measured history');
  const median = values => { const s=[...values].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
  const bins = [false,true].map(weekend => Array.from({length:24},(_,hour) => {
    const same=rows.filter(p=>p.hour===hour && p.weekend===weekend), all=rows.filter(p=>p.hour===hour);
    const group=same.length>=2?same:all;
    if (group.length < 2) throw new Error('Incomplete measured daily profile');
    return {houseW:Math.round(median(group.map(p=>p.house))),
      evW:Math.round(group.reduce((s,p)=>s+p.ev,0)/group.length),
      phaseW:Math.round(median(group.map(p=>p.phase))),samples:group.length};
  }));
  return {version:1,updatedAt:now,source:'homey-insights',basis:'gross-house-excluding-ev',
    samples:rows.length,first:Math.min(...rows.map(p=>p.at)),last:Math.max(...rows.map(p=>p.at)),bins};
}

export function sessyLiveState(battery, grid, charger, config, now) {
  const b=battery?.capabilitiesObj||{},g=grid?.capabilitiesObj||{},e=charger?.capabilitiesObj||{};
  const value=(caps,key)=>caps[key]?.value;
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const fresh=(caps,key)=>{
    const raw=caps[key]?.lastUpdated, stamp=typeof raw==='number'?raw/1000:Date.parse(raw)/1000;
    return finite(stamp)&&stamp>=now-60&&stamp<=now+30;
  };
  const phase=config?.phase;
  const site=config?.version===1&&config.phases===3&&config.fuseA===25&&[1,2,3].includes(phase)&&config.marginA>=2&&config.marginA<10;
  const available=battery?.available===true&&grid?.available===true;
  // Like the EV, a held 0 W battery target can remain unchanged for hours.
  // Independent changing mains measurements prove the device poll is alive.
  const batteryHeartbeat=['measure_power','measure_frequency','measure_voltage.p1'].some(k=>fresh(b,k));
  const gridHeartbeat=['measure_power','measure_voltage.l'+phase].some(k=>fresh(g,k));
  const live=available&&batteryHeartbeat&&gridHeartbeat&&
    finite(value(b,'measure_power'))&&finite(value(g,'measure_power'));
  // A capability timestamp records changes, not polling: unchanged EV zero/false
  // values can be old. A changing voltage heartbeat proves the current poll.
  const evKnown=charger?.available===true&&fresh(e,'measure_voltage')&&value(e,'alarm_device')===false&&
    finite(value(e,'measure_power'))&&typeof value(e,'is_charging')==='boolean';
  const ev=evKnown?(value(e,'is_charging')||value(e,'measure_power')>50):null;
  const ac=value(b,'measure_power'),voltage=value(g,'measure_voltage.l'+phase),amps=value(g,'measure_current.l'+phase),phaseW=value(g,'measure_power.l'+phase);
  const phaseKnown=live&&site&&finite(ac)&&finite(voltage)&&voltage>=200&&voltage<=260&&finite(amps)&&amps>=0&&finite(phaseW);
  // Restore the present battery AC contribution before calculating a new target.
  // VA (not only real W) and a 2 A margin conservatively cover other phase loads.
  const baseVA=phaseKnown?Math.max(0,Math.max(Math.abs(phaseW),amps*voltage)-ac):null;
  const headroomW=baseVA===null?null:Math.max(0,Math.floor((config.fuseA-config.marginA)*voltage-baseVA));
  return {available:live,fault:value(b,'alarm_fault')!==false,soc:value(b,'measure_battery'),ev,headroomW,
    siteNetW:live&&finite(ac)?value(g,'measure_power')-ac:null,
    houseNetW:live&&finite(ac)&&finite(value(g,'measure_power'))&&evKnown?
      value(g,'measure_power')-ac-value(e,'measure_power'):null,
    chargeLimitW:Math.min(2200,battery?.settings?.power_max_charge??0),
    dischargeLimitW:Math.min(1800,battery?.settings?.power_max_discharge??0),
    manual:value(b,'override')===true||value(b,'control_strategy')!=='POWER_STRATEGY_API',
    commandW:finite(value(b,'meter_setpoint'))?value(b,'meter_setpoint'):null};
}

export function executeSessyPlan(plan,state,now) {
  const stopped=reason=>({updatedAt:now,mode:'paused',reason,targetW:0,plannedW:0,commandW:state.commandW??null});
  if (!state.available) return stopped('stale-readings');
  if (state.fault || !Number.isFinite(state.soc) || state.soc<0 || state.soc>100) return stopped('battery-unavailable');
  if (state.manual) return stopped('manual-mode');
  if (state.ev===null || !Number.isFinite(state.houseNetW)) return stopped('ev-unknown');
  if (!plan || plan.mode!=='active'||plan.inputQuality!=='calibrated'||now>=plan.validUntil||now-plan.updatedAt>600) return stopped('plan-unavailable');
  const q=plan.intervals.find(q=>q.from<=now&&q.until>now);
  if (!q) return stopped('plan-unavailable');
  let watts=sessyTarget(plan,state,now),reason='following';
  const siteNetW=Number.isFinite(state.siteNetW)?state.siteNetW:state.houseNetW;
  if (siteNetW<0 && state.soc<100) reason='solar-surplus';
  else if (q.action==='discharge'&&state.ev) reason='ev-charging';
  else if (q.action==='discharge'&&state.soc<=plan.reservePercent) reason='reserve';
  else if (q.action==='charge'&&(!Number.isFinite(state.headroomW)||-q.powerW>state.headroomW)) reason='phase-limit';
  if (watts<0) {
    const limit=Number.isFinite(state.headroomW)?Math.max(0,Math.min(state.headroomW,state.chargeLimitW)):0;
    if (-watts>limit) reason='phase-limit';
    watts=-Math.min(-watts,limit);
  } else watts=Math.min(watts,Math.max(0,state.dischargeLimitW));
  const chargeWindow=sessyChargeWindow(plan,state,now);
  return {updatedAt:now,mode:'active',reason,targetW:Math.round(watts)||0,plannedW:q.powerW,chargeWindow,
    commandW:state.commandW??null,headroomW:state.headroomW};
}
