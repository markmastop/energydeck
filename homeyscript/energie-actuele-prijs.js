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
// Match EnergyDeck's configured tax (ex VAT), VAT and supplier fee (incl VAT).
// Defaults: Netherlands / Zonneplan 2026 (matches .env defaults).
const ENERGY_TAX_EX_VAT_CT = 9.161;
const VAT_MULTIPLIER = 1.21;
const SUPPLIER_FEE_INCL_VAT_CT = 2.0;

// Dashboard-only values: do not change the legacy Sessy control variables.
async function publishDashboard(ok, value, mean, values, sourceName, interval, reason) {
  let category = 'N';
  let label = '⚠ Geen geldige prijzen | ' + reason;
  if (ok) {
    // Match the deck's Today graph: noon-to-noon when tomorrow is complete.
    const nextDay = new Date(midday + 86400000).toISOString().slice(0, 10);
    const tomorrow = data.tomorrow;
    const nextValues = tomorrow?.date === nextDay && Array.isArray(tomorrow.values)
      && tomorrow.values.length === dayBounds(nextDay).count && tomorrow.values.every(v => typeof v === 'number' && Number.isFinite(v))
      ? tomorrow.values : null;
    const window = Number(p.hour) >= 12 && nextValues
      ? values.slice(bounds.count - 48).concat(nextValues.slice(0, dayBounds(nextDay).count - 48)) : values;
    const minimum = Math.min(...window);
    // Firmware floors the all-in EUR/kWh span at 0.001; convert to raw units.
    const span = Math.max(0.001 / VAT_MULTIPLIER, Math.max(...window) - minimum);
    category = value <= minimum + span * 0.33 ? 'C' : value >= minimum + span * 0.66 ? 'E' : 'N';
    // Match EnergyDeck's configured tax (ex VAT), VAT and supplier fee (incl VAT).
    // Presentation only: cached market prices and charging signals remain raw.
    const allInCents = raw => ((raw * 100 + ENERGY_TAX_EX_VAT_CT) * VAT_MULTIPLIER + SUPPLIER_FEE_INCL_VAT_CT).toFixed(1).replace('.', ',');
    const sourceLabel = /epex/i.test(sourceName) ? '⚠' : /^homey/i.test(sourceName) ? 'Homey' : '⚠ Bron?';
    // Put provenance first so narrow DataVista rows cannot truncate the warning.
    label = sourceLabel + ' | ' + allInCents(value) + ' ct | gem. ' + allInCents(mean) + ' | ' + category;
  }
  await set('Energie - Dashboardcategorie', category);
  await set('Energie - Dashboardadvies', !ok ? '⚠ Geen geldige prijzen' : category === 'C' ? 'Nu apparaten gebruiken' : category === 'E' ? 'Beperk energiegebruik' : 'Zijn de apparaten echt nodig?');
  await set('Energie - Dashboardprijs', label);
}
function dayBounds(date) {
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

// BEGIN shared EV policy (kept in parity with web/public/ev-plan.js).
function evChargingPlan(days) {
  const quarters=24,slots=[];
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  for(const day of days) {
    if(!day?.date || !Array.isArray(day.values))continue;
    const bounds=dayBounds(day.date);
    if(day.values.length!==bounds.count || !day.values.every(Number.isFinite))continue;
    for(let i=0;i<day.values.length;i++) {
      const from=bounds.start/1000+i*900,parts=Object.fromEntries(local.formatToParts(new Date(from*1000)).map(p=>[p.type,p.value]));
      let date=`${parts.year}-${parts.month}-${parts.day}`;
      const hour=Number(parts.hour),period=hour>=8&&hour<20?'day':'night';
      if(hour<8){const previous=new Date(`${date}T12:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);date=previous.toISOString().slice(0,10);}
      slots.push({from,until:from+900,price:day.values[i],key:`${date}:${period}`,period});
    }
  }
  slots.sort((a,b)=>a.from-b.from);
  const best=new Map();
  for(let i=0;i<=slots.length-quarters;i++) {
    const qs=slots.slice(i,i+quarters),first=qs[0];
    if(!qs.every((q,j)=>q.key===first.key&&q.from===first.from+j*900))continue;
    const cost=qs.reduce((sum,q)=>sum+q.price,0),previous=best.get(first.key);
    if(!previous || cost<previous.cost)best.set(first.key,{from:first.from,until:qs.at(-1).until,cost,period:first.period});
  }
  const windows=[...best.values()].sort((a,b)=>a.from-b.from);
  return {slots,windows};
}

function evChargingState(plan,now=Date.now()/1000) {
  const current=plan.slots.find(q=>q.from<=now&&q.until>now);
  if(!current)return {state:'unknown',window:null};
  const window=plan.windows.find(q=>q.from<=now&&q.until>now);
  return {state:window?'allow':'wait',window:window??plan.windows.find(q=>q.from>now)??null};
}

// END shared EV policy.

const now = new Date();
const fmt = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
function parts(d) { return Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value])); }
const p = parts(now), day = p.year + '-' + p.month + '-' + p.day;
let data = {}, problem = '';
try { data = JSON.parse(byName['EnergyDeck Prices']?.value || '{}'); } catch (_) { problem = 'Opgeslagen prijzen onleesbaar'; }
const prices = [data.today, data.tomorrow].find(d => d?.date === day)?.values;
const bounds = dayBounds(day);
const valid = Array.isArray(prices) && prices.length === bounds.count && prices.every(v => typeof v === 'number' && Number.isFinite(v));
const midday = Date.parse(day + 'T12:00:00Z');
if (!valid && !problem) problem = 'Geen volledige geldige prijzen voor vandaag';
const source = data.sources?.[day] || 'Onbekend';
if (!valid) await set('Energie - Prijzen geldig', false);
await set('Energie - Homey prijzen beschikbaar', data.homeyAvailable?.[day] === true);
await set('Energie - Prijsbron', valid ? source : 'Geen');
await set('Energie - Laatste prijscontrole', data.checkedAt || 'Onbekend');
await set('Energie - Laatste succesvolle update', data.fetchedAt?.[day] || data.updatedAt || 'Onbekend');
// Use only today's and the next published calendar day, just like the clients.
const nextDate = new Date(midday + 86400000).toISOString().slice(0, 10);
const evDays = [day, nextDate].map(date => [data.today, data.tomorrow].find(d => d?.date === date));
const evState = valid ? evChargingState(evChargingPlan(evDays), now.getTime()/1000) : {state: 'unknown', window: null};
const evAllowed = evState.state === 'allow';
// Permission is published before the completion signal; manual overrides live in Auto - Run.
await set('Energie - EV zesuursplan toegestaan', evAllowed);
await set('Energie - EV zesuursplan', JSON.stringify({day, state: evState.state, window: evState.window}));
if (!valid) await set('Energie - Goedkoopste 3 uren', false);
if (!valid) await set('Energie - Goedkoopste 7 uren', false);
if (!valid) {
  await set('Energie - Prijsstatus', problem);
  await set('Energie - Prijsinterval', 'Geen geldig interval');
  await publishDashboard(false, 0, 0, [], '', '', problem);
  // Publish only after all invalidation flags are written.
  await set('Energie - Prijsupdate', JSON.stringify({day, valid: false, evSixHourAllowed: false}));
  return {ok: false, reason: problem};
}
// Rank real elapsed hours so repeated clock hours remain independent.
const quarter = Math.floor((now.getTime() - bounds.start) / 900000), hour = Math.floor(quarter / 4);
// Break equal-price ties by chronological order.
const hourly = Array.from({length: prices.length / 4}, (_, h) => ({h, price: prices.slice(h*4, h*4+4).reduce((a,b) => a+b, 0) / 4}));
hourly.sort((a,b) => a.price - b.price || a.h - b.h);
const top3 = hourly.slice(0,3).some(x => x.h === hour), top7 = hourly.slice(0,7).some(x => x.h === hour);
await set('Energie - Marktprijs EUR per kWh', prices[quarter]);
await set('Energie - Gemiddelde marktprijs EUR per kWh', prices.reduce((a,b) => a+b, 0) / prices.length);
await set('Energie - Goedkoopste 3 uren', top3);
await set('Energie - Goedkoopste 7 uren', top7);
await set('Energie - Prijsstatus', 'Geldig | ' + source + (data.warnings?.some(w => w.includes(day + ': eerder opgeslagen')) ? ' | bewaarde dagprijzen' : ''));
await set('Energie - Prijzen geldig', true);
const offset = bounds.count !== 96 ? ' ' + new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Amsterdam', timeZoneName: 'shortOffset'}).formatToParts(now).find(p => p.type === 'timeZoneName').value : '';
await set('Energie - Prijsinterval', day + ' ' + p.hour + ':' + String(Math.floor(Number(p.minute)/15)*15).padStart(2,'0') + offset);
await publishDashboard(true, prices[quarter], prices.reduce((a,b) => a+b, 0) / prices.length, prices, source, p.hour + ':' + String(Math.floor(Number(p.minute)/15)*15).padStart(2,'0'), '');
// Stable completion signal: also changes for corrected prices/rankings within a quarter.
await set('Energie - Prijsupdate', JSON.stringify({day, quarter, valid: true, price: prices[quarter], cheapest3Hours: top3, cheapest7Hours: top7, evSixHourAllowed: evAllowed}));
return {ok: true, day, quarter, source, marketPrice: prices[quarter], cheapest3Hours: top3, cheapest7Hours: top7, evSixHourAllowed: evAllowed};
