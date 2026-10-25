// Amsterdam calendar boundaries are independent of the browser/server timezone.
export function priceDayBounds(date) {
  const midnight = day => {
    const utc = Date.parse(`${day}T00:00:00Z`);
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(utc)).find(p => p.type === 'timeZoneName').value;
    return utc - Number(zone.match(/GMT\+(\d+)/)?.[1] || 0) * 3600000;
  };
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = midnight(date), end = midnight(next.toISOString().slice(0, 10));
  return { start, end, count: (end - start) / 900000 };
}

export function priceQuarter(day, now = Date.now()) {
  return Math.floor((Number(now) - (day.start ?? priceDayBounds(day.date).start)) / 900000);
}

export function priceTime(timestamp, withOffset = false) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23', ...(withOffset ? { timeZoneName: 'shortOffset' } : {}) }).format(new Date(timestamp));
}

export function priceWindow(today, tomorrow, quarter) {
  if (!today) return null;
  const bounds = today.date ? priceDayBounds(today.date) : null;
  // Noon is twelve real hours before the next midnight on Amsterdam DST days.
  const noon = bounds ? (bounds.end - 43200000 - bounds.start) / 900000 : 48;
  const nextNoon = tomorrow?.date ? (priceDayBounds(tomorrow.date).count - 48) : 48;
  const offset = tomorrow && quarter >= noon ? noon : 0;
  const values = offset ? [...today.values.slice(offset), ...tomorrow.values.slice(0, nextNoon)] : today.values;
  let cheapest = 0;
  const sum = i => values.slice(i, i + 12).reduce((a, b) => a + b, 0);
  for (let i = 1; i <= values.length - 12; i++) if (sum(i) < sum(cheapest)) cheapest = i;
  return { values, offset, start: bounds ? bounds.start + offset * 900000 : null, cheapest, minimum: Math.min(...values), maximum: Math.max(...values), average: values.reduce((a, b) => a + b, 0) / values.length };
}

export function lineSegments(points, signed) {
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.time - a.time !== 300000) continue;
    if (signed && a.value * b.value < 0) {
      const zero = { time: a.time + (b.time - a.time) * a.value / (a.value - b.value), value: 0 };
      segments.push([a, zero], [zero, b]);
    } else segments.push([a, b]);
  }
  return segments;
}
