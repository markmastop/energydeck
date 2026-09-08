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
  return {ok: false, reason: problem};
}
const hour = Number(p.hour), quarter = hour * 4 + Math.floor(Number(p.minute) / 15);
// Rank clock hours by the mean of their four quarters; break equal-price ties by time.
const hourly = Array.from({length: 24}, (_, h) => ({h, price: prices.slice(h*4, h*4+4).reduce((a,b) => a+b, 0) / 4}));
hourly.sort((a,b) => a.price - b.price || a.h - b.h);
const top3 = hourly.slice(0,3).some(x => x.h === hour), top7 = hourly.slice(0,7).some(x => x.h === hour);
await set('Energie - Marktprijs EUR per kWh', prices[quarter]);
await set('Energie - Gemiddelde marktprijs EUR per kWh', prices.reduce((a,b) => a+b, 0) / 96);
await set('Energie - Prijsinterval', day + ' ' + p.hour + ':' + String(Math.floor(Number(p.minute)/15)*15).padStart(2,'0'));
await set('Energie - Goedkoopste 3 uren', top3);
await set('Energie - Goedkoopste 7 uren', top7);
await set('Energie - Prijsstatus', 'Geldig | ' + source + (data.warnings?.some(w => w.includes(day + ': eerder opgeslagen')) ? ' | bewaarde dagprijzen' : ''));
await set('Energie - Prijzen geldig', true);
return {ok: true, day, quarter, source, marketPrice: prices[quarter], cheapest3Hours: top3, cheapest7Hours: top7};
