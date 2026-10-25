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
