// Read-only contract shared with battery_plan.h. Never infer controller state
// from battery power or show a stale plan as current during manual overrides.
export function batteryPlan(raw, now = new Date()) {
  let value;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const finite = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
  // v1 envelopes keep old firmware compatible and expire during manual control.
  // A malformed optional proposal falls back to the real running v1 controller.
  if (value?.version === 1 && value.forwardPlan && value.day === day &&
      finite(value.updatedAt, now.getTime()/1000 - 180, now.getTime()/1000 + 30)) {
    const forward = forwardBatteryPlan(value.forwardPlan, now);
    if (forward) return {...forward,controllerUpdatedAt:value.updatedAt};
  }
  if (value?.version === 2) return forwardBatteryPlan(value, now);
  if (!value || value.version !== 1 || value.day !== day || typeof value.enabled !== 'boolean' ||
      !['normal', 'disabled', 'solar-and-reserve', 'grid-top-up', 'full-reserve'].includes(value.phase) ||
      !finite(value.updatedAt, now.getTime() / 1000 - 180, now.getTime() / 1000 + 30) ||
      !finite(value.capacityKwh, 1, 100) || !finite(value.topUpW, 100, 10000) ||
      value.targetPercent !== 100 || !finite(value.reserveMinute, 0, 1439) ||
      !finite(value.deadlineMinute, value.reserveMinute + 1, 1439) ||
      (value.startMinute !== null && !finite(value.startMinute, value.reserveMinute, value.deadlineMinute))) return null;
  const sunValid = finite(value.sunMinutes, 0, 180) && finite(value.sunWindowMinutes, 15, 180) && value.sunMinutes <= value.sunWindowMinutes;
  let sunPeriods = [];
  if (sunValid && Array.isArray(value.sunPeriods) && value.sunPeriods.length <= 16 && value.sunPeriods.every((p, i, all) =>
      p && finite(p.from, value.reserveMinute, value.deadlineMinute) && finite(p.until, p.from + 0.001, value.deadlineMinute) &&
      p.until - p.from <= 15.02 && finite(p.fraction, 0, 1) && (!i || Math.abs(p.from - all[i - 1].until) <= 0.02))) {
    sunPeriods = value.sunPeriods.map(({from, until, fraction}) => ({from, until, fraction}));
  }
  return {version: 1, day, updatedAt: value.updatedAt, enabled: value.enabled, phase: value.phase,
    sunPeriods, sunMinutes: sunValid ? value.sunMinutes : null, sunWindowMinutes: sunValid ? value.sunWindowMinutes : null,
    sunAdvanceMinutes: sunValid && finite(value.sunAdvanceMinutes, 0, 60) ? value.sunAdvanceMinutes : 0,
    capacityKwh: value.capacityKwh, topUpW: value.topUpW, targetPercent: value.targetPercent,
    reserveMinute: value.reserveMinute, deadlineMinute: value.deadlineMinute, startMinute: value.startMinute};
}

export function planClock(minute) {
  return minute === null ? '—' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
}

export function batteryPlanView(raw, now = new Date()) {
  const plan = batteryPlan(raw, now);
  if (!plan) return {plan: null, label: 'batteryPlanUnavailable', start: null, now: null};
  if (plan.version === 2) {
    const epoch = now.getTime()/1000, from = plan.intervals[0].from, until = plan.intervals.at(-1).until;
    const position = n => Math.max(0, Math.min(100, (n-from)/(until-from)*100));
    const current = plan.intervals.find(q=>q.from<=epoch && q.until>epoch);
    if (!current) return {plan:null,label:'batteryPlanUnavailable',start:null,now:null};
    const next = plan.intervals.find(q=>q.from>epoch && q.action!==current.action);
    return {plan,label:`batteryAction${current.action}`,current,next,from,until,start:null,now:position(epoch),
      phases:plan.intervals.map(q=>({...q,left:position(q.from),width:position(q.until)-position(q.from)})),
      sunshine:plan.intervals.filter(q=>q.sun!==null && q.until>epoch).map(q=>({
        left:position(Math.max(q.from,epoch)),width:position(q.until)-position(Math.max(q.from,epoch)),fraction:q.sun}))};
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Amsterdam',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now).map(p => [p.type, p.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const position = n => Math.max(0, Math.min(100, (n - plan.reserveMinute) / (plan.deadlineMinute - plan.reserveMinute) * 100));
  const label = !plan.enabled ? 'batteryPlanOff' : plan.phase === 'grid-top-up' ? 'batteryPlanTopup' :
    plan.phase === 'full-reserve' ? 'batteryPlanReserve' : plan.phase === 'normal' ? 'batteryPlanNormal' : 'batteryPlanSolar';
  const sunshine = plan.sunPeriods.filter(p => p.until > minute).map(p => ({
    left: position(Math.max(minute, p.from)), width: position(p.until) - position(Math.max(minute, p.from)), fraction: p.fraction,
  }));
  return {plan, label, sunshine, start: plan.startMinute === null ? null : position(plan.startMinute), now: position(minute)};
}

export function forwardBatteryPlan(p, now = new Date()) {
  const epoch=now.getTime()/1000;
  const finite=(v,lo,hi)=>typeof v==='number' && Number.isFinite(v) && v>=lo && v<=hi;
  if (!p || p.version!==2 || !['shadow','active'].includes(p.mode) ||
      !['calibrated','provisional'].includes(p.inputQuality) || typeof p.atRisk!=='boolean' ||
      (p.mode==='active' && p.inputQuality!=='calibrated') ||
      (p.controllerUpdatedAt!==undefined && !finite(p.controllerUpdatedAt,epoch-180,epoch+30)) ||
      !finite(p.updatedAt,epoch-600,epoch+30) || !finite(p.validUntil,epoch+.001,p.updatedAt+600) ||
      !finite(p.capacityKwh,1,100) || !finite(p.reservePercent,0,50) || !finite(p.endReservePercent,p.reservePercent,100) ||
      !finite(p.topUpW,0,1000) || !Array.isArray(p.intervals) || !p.intervals.length || p.intervals.length>145) return null;
  const intervals=[];
  for (const [i,q] of p.intervals.entries()) {
    if (!q || !finite(q.from,p.updatedAt,p.updatedAt+129600) || !finite(q.until,q.from+1,q.from+900) ||
        q.until>p.updatedAt+129600 || (i ? q.from!==intervals[i-1].until : q.from!==p.updatedAt) ||
        !['charge','hold','discharge'].includes(q.action) || !finite(q.powerW,-2200,1800) ||
        (q.action==='charge' ? q.powerW>=0 : q.action==='discharge' ? q.powerW<=0 : q.powerW!==0) ||
        (q.ev!==false && q.action==='discharge') || ![true,false,null].includes(q.ev) ||
        !finite(q.socFrom,0,100) || !finite(q.socTo,0,100) || !finite(q.price,-1000,1000) ||
        !(q.sun===null || finite(q.sun,0,1))) return null;
    intervals.push({from:q.from,until:q.until,action:q.action,powerW:q.powerW,socFrom:q.socFrom,socTo:q.socTo,price:q.price,sun:q.sun,ev:q.ev});
  }
  if (!intervals.some(q=>q.from<=epoch && q.until>epoch)) return null;
  return {version:2,enabled:true,mode:p.mode,inputQuality:p.inputQuality,atRisk:p.atRisk,
    updatedAt:p.updatedAt,validUntil:p.validUntil,...(p.controllerUpdatedAt!==undefined?{controllerUpdatedAt:p.controllerUpdatedAt}:{}),capacityKwh:p.capacityKwh,reservePercent:p.reservePercent,
    endReservePercent:p.endReservePercent,topUpW:p.topUpW,intervals};
}

export function forwardClock(epoch, now = new Date(), locale='nl') {
  const stamp=new Date(epoch*1000);
  const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  return new Intl.DateTimeFormat(locale,{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
    ...(day(stamp)!==day(now)?{day:'2-digit',month:'2-digit'}:{})}).format(stamp);
}
