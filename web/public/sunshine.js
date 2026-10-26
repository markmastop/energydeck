// Open-Meteo sunshine seconds refer to the PRECEDING quarter hour. Rebinning
// to rain's five-minute columns assumes a uniform distribution within a quarter.
export function sunshineSeries(raw, now = new Date()) {
  const times = raw?.minutely_15?.time, seconds = raw?.minutely_15?.sunshine_duration;
  if (raw?.minutely_15_units?.sunshine_duration !== 's' || !Array.isArray(times) || !times.length || times.length > 32 ||
      !Array.isArray(seconds) || times.length !== seconds.length) return null;
  if (!times.every((end, i) => Number.isInteger(end) && end >= 900 && (!i || end - times[i-1] === 900) &&
      typeof seconds[i] === 'number' && Number.isFinite(seconds[i]) && seconds[i] >= 0 && seconds[i] <= 900)) return null;
  return {updatedAt: now.getTime(), periods: times.map((end,i) => ({from:(end-900)*1000, until:end*1000, fraction:seconds[i]/900}))};
}
export function sunshineFraction(series, from, until, now = Date.now()) {
  if (!series || !Number.isFinite(series.updatedAt) || now - series.updatedAt > 2700000 || series.updatedAt - now > 30000 ||
      !Array.isArray(series.periods) || series.periods.length > 32 || !Number.isFinite(from) || !Number.isFinite(until) || until <= from) return null;
  let cursor = from, sunshine = 0;
  for (const p of series.periods) {
    if (!p || !Number.isFinite(p.from) || !Number.isFinite(p.until) || p.until - p.from !== 900000 ||
        !Number.isFinite(p.fraction) || p.fraction < 0 || p.fraction > 1) return null;
    if (p.until <= cursor || p.from >= until) continue;
    if (p.from > cursor) return null;
    const end = Math.min(p.until, until);
    sunshine += p.fraction * (end - cursor); cursor = end;
  }
  return cursor === until ? sunshine / (until - from) : null;
}

// Prefer the weather card's current forecast; retain valid plan coverage farther
// ahead. Sunshine is a display signal and never changes planned battery energy.
export function batterySunshine(series, from, until, fallback, now = Date.now()) {
  const fraction = sunshineFraction(series, Math.max(from * 1000, now), until * 1000, now);
  return fraction ?? fallback;
}
