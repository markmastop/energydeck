/* Read cached day prices only. No network requests. Raw market prices in EUR/kWh. */
const variables = await Homey.logic.getVariables();
const byName = Object.fromEntries(Object.values(variables).map(v => [v.name, v]));
async function set(name, value) {
  const old = byName[name];
  if (old && old.type !== typeof value) throw new Error('Wrong variable type: ' + name);
  // Avoid triggering dependent Flows when the value has not changed.
  if (old && old.value === value) return;
  if (old) await Homey.logic.updateVariable({id: old.id, variable: {value}});
  else await Homey.logic.createVariable({variable: {name, type: typeof value, value}});
}
// Dashboard-only values: do not change the legacy Sessy control variables.
async function publishDashboard(ok, value, mean, values, sourceName, interval, reason) {
  let category = 'N';
  let label = '⚠ Geen geldige prijzen | ' + reason;
  if (ok) {
    const step = (Math.max(...values) - Math.min(...values)) / 5;
    const normal = mean + 0.5 * step;
    category = step === 0 ? 'N' : value <= normal - 2 * step ? 'VC' : value <= normal - step ? 'C' : value <= normal ? 'N' : value <= normal + step ? 'E' : 'VE';
    // Match EnergyDeck's configured tax (ex VAT), VAT and supplier fee (incl VAT).
    // Presentation only: cached market prices and charging signals remain raw.
    const allInCents = raw => ((raw * 100 + 9.161) * 1.21 + 2.0).toFixed(1).replace('.', ',');
    const sourceLabel = /epex/i.test(sourceName) ? '⚠ Epex' : /^homey/i.test(sourceName) ? 'Homey' : '⚠ Bron?';
    // Put provenance first so narrow DataVista rows cannot truncate the warning.
    label = sourceLabel + ' | ' + allInCents(value) + ' ct/kWh | gem. ' + allInCents(mean) + ' | ' + category;
  }
  await set('Energie - Dashboardcategorie', category);
  await set('Energie - Dashboardprijs', label);
}
const now = new Date();
const fmt = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
function parts(d) { return Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value])); }
const p = parts(now), day = p.year + '-' + p.month + '-' + p.day;
let data = {}, problem = '';
try { data = JSON.parse(byName['EnergyDeck Prices']?.value || '{}'); } catch (_) { problem = 'Opgeslagen prijzen onleesbaar'; }
const prices = [data.today, data.tomorrow].find(d => d?.date === day)?.values;
let valid = Array.isArray(prices) && prices.length === 96 && prices.every(v => typeof v === 'number' && Number.isFinite(v));
// A 96-value array has no unambiguous mapping on daylight-saving transition days.
const midday = Date.parse(day + 'T12:00:00Z');
let hoursInDay = 0;
for (let t = midday - 24*3600000; t <= midday + 24*3600000; t += 3600000) {
  const q = parts(new Date(t));
  if (q.year + '-' + q.month + '-' + q.day === day) hoursInDay++;
}
if (hoursInDay !== 24) { valid = false; problem = 'Zomer/wintertijd-dag: 96 kwartieren niet veilig bruikbaar'; }
if (!valid && !problem) problem = 'Geen volledige geldige prijzen voor vandaag';
const source = data.sources?.[day] || 'Onbekend';
if (!valid) await set('Energie - Prijzen geldig', false);
await set('Energie - Homey prijzen beschikbaar', data.homeyAvailable?.[day] === true);
await set('Energie - Prijsbron', valid ? source : 'Geen');
await set('Energie - Laatste prijscontrole', data.checkedAt || 'Onbekend');
await set('Energie - Laatste succesvolle update', data.fetchedAt?.[day] || data.updatedAt || 'Onbekend');
if (!valid) await set('Energie - Goedkoopste 3 uren', false);
if (!valid) await set('Energie - Goedkoopste 7 uren', false);
if (!valid) {
  await set('Energie - Prijsstatus', problem);
  await set('Energie - Prijsinterval', 'Geen geldig interval');
  await publishDashboard(false, 0, 0, [], '', '', problem);
  // Publish only after all invalidation flags are written.
  await set('Energie - Prijsupdate', JSON.stringify({day, valid: false}));
  return {ok: false, reason: problem};
}
const hour = Number(p.hour), quarter = hour * 4 + Math.floor(Number(p.minute) / 15);
// Rank clock hours by the mean of their four quarters; break equal-price ties by time.
const hourly = Array.from({length: 24}, (_, h) => ({h, price: prices.slice(h*4, h*4+4).reduce((a,b) => a+b, 0) / 4}));
hourly.sort((a,b) => a.price - b.price || a.h - b.h);
const top3 = hourly.slice(0,3).some(x => x.h === hour), top7 = hourly.slice(0,7).some(x => x.h === hour);
await set('Energie - Marktprijs EUR per kWh', prices[quarter]);
await set('Energie - Gemiddelde marktprijs EUR per kWh', prices.reduce((a,b) => a+b, 0) / 96);
await set('Energie - Goedkoopste 3 uren', top3);
await set('Energie - Goedkoopste 7 uren', top7);
await set('Energie - Prijsstatus', 'Geldig | ' + source + (data.warnings?.some(w => w.includes(day + ': eerder opgeslagen')) ? ' | bewaarde dagprijzen' : ''));
await set('Energie - Prijzen geldig', true);
await set('Energie - Prijsinterval', day + ' ' + p.hour + ':' + String(Math.floor(Number(p.minute)/15)*15).padStart(2,'0'));
await publishDashboard(true, prices[quarter], prices.reduce((a,b) => a+b, 0) / 96, prices, source, p.hour + ':' + String(Math.floor(Number(p.minute)/15)*15).padStart(2,'0'), '');
// Stable completion signal: also changes for corrected prices/rankings within a quarter.
await set('Energie - Prijsupdate', JSON.stringify({day, quarter, valid: true, price: prices[quarter], cheapest3Hours: top3, cheapest7Hours: top7}));
return {ok: true, day, quarter, source, marketPrice: prices[quarter], cheapest3Hours: top3, cheapest7Hours: top7};
