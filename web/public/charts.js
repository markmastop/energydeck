export function priceWindow(today, tomorrow, quarter) {
  if (!today) return null;
  const offset = tomorrow && quarter >= 48 ? 48 : 0;
  const values = offset ? [...today.values.slice(48), ...tomorrow.values.slice(0, 48)] : today.values;
  let cheapest = 0;
  const sum = i => values.slice(i, i + 12).reduce((a, b) => a + b, 0);
  for (let i = 1; i <= values.length - 12; i++) if (sum(i) < sum(cheapest)) cheapest = i;
  return { values, offset, cheapest, minimum: Math.min(...values), maximum: Math.max(...values), average: values.reduce((a, b) => a + b, 0) / values.length };
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
