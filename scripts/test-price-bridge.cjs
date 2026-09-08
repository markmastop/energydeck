// Run the actual HomeyScript with a mocked Homey API; no network or Flow calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../homeyscript/energydeck-prices.js'), 'utf8');

async function run(instant, failTomorrow = false, failToday = false, invalid = false, reserve = null, previous = null) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
  }
  const requested = [];
  const writes = [];
  const logs = [];
  const Homey = {
    energy: { async fetchDynamicElectricityPrices({ date }) {
      requested.push(date);
      if ((requested.length === 1 && failToday) || (requested.length === 2 && failTomorrow)) {
        throw new Error('NotFoundError');
      }
      return { pricesPerInterval: Array.from({ length: 96 }, () => ({ value: invalid ? NaN : 0.12 })) };
    } },
    logic: {
      async getVariables() { return { existing: { id: 'existing', name: 'EnergyDeck Prices', value: previous ? JSON.stringify(previous) : undefined } }; },
      async updateVariable({ id, variable }) { writes.push(JSON.parse(variable.value)); return { id }; },
    },
  };
  const result = await vm.runInNewContext(`(async () => {${source}\n})()`, {
    Homey, Date: FixedDate, Intl, log: message => logs.push(message),
    fetch: async () => reserve ? {ok: true, json: async () => reserve} : {ok: false, status: 404},
  }).then(value => ({ value }), error => ({ error }));
  return { ...result, requested, writes, logs };
}

(async () => {
  for (const [instant, today, tomorrow] of [
    ['2026-09-05T23:00:00Z', '2026-09-06', '2026-09-07'],
    ['2026-03-28T23:30:00Z', '2026-03-29', '2026-03-30'],
    ['2026-10-24T23:30:00Z', '2026-10-25', '2026-10-26'],
    ['2026-12-31T23:30:00Z', '2027-01-01', '2027-01-02'],
  ]) {
    const r = await run(instant, true);
    assert.equal(r.error, undefined);
    assert.deepEqual(r.requested, [today, tomorrow]);
    assert.equal(r.writes.length, 1);
    assert.equal(r.writes[0].today.date, today);
    assert.equal(r.writes[0].today.values.length, 96);
    assert.equal(r.writes[0].tomorrow.values.length, 0);
    assert.equal(r.value.warnings.length, 2);
    assert.match(r.logs.join('\n'), new RegExp(tomorrow));
  }
  const available = await run('2026-09-06T10:00:00Z');
  assert.equal(available.writes[0].tomorrow.values.length, 96);
  assert.equal(available.value.warnings.length, 0);
  assert.equal(available.writes[0].today.source, 'homey');
  assert.equal(available.writes[0].tomorrow.source, 'homey');
  const missing = await run('2026-09-06T10:00:00Z', false, true);
  assert.equal(missing.error, undefined);
  assert.equal(missing.value.ok, false);
  assert.equal(missing.writes[0].today.values.length, 0);
  assert.equal(missing.writes[0].today.source, 'unavailable');
  assert.equal(missing.writes[0].homeyAvailable['2026-09-06'], false);
  const invalid = await run('2026-09-06T10:00:00Z', false, false, true);
  assert.equal(invalid.value.ok, false);
  assert.equal(invalid.writes[0].today.values.length, 0);
  assert.match(invalid.value.warnings.join(' '), /finite numeric/);
  const fixture = {

    today: Array.from({length: 96}, (_, i) => ({date: new Date(Date.parse('2026-09-06T00:00:00+02:00') + i * 900000).toISOString(), price: i === 0 ? -0.05 : 0.12})),

  };
  const fallback = await run('2026-09-06T10:00:00Z', false, true, false, fixture);
  assert.equal(fallback.error, undefined);
  assert.equal(fallback.writes[0].today.values[0], -0.05);
  assert.equal(fallback.writes[0].today.values[1], 0.12);
  assert.equal(fallback.writes[0].today.source, 'epexprijzen');
  assert.match(fallback.value.sources['2026-09-06'], /EpexPrijzen/);
  for (const bad of [
    {today: null},
    {today: fixture.today.slice(1)},
    {today: fixture.today.map(s => ({...s, price: null}))},
    {today: fixture.today.map(s => ({...s, date: s.date.slice(0, -1)}))},
    {today: fixture.today.map(s => ({...s, date: new Date(Date.parse(s.date)-86400000).toISOString()}))},
    {today: fixture.today.map((s,i) => i===20 ? fixture.today[19] : s)},
  ]) {
    const rejected = await run('2026-09-06T10:00:00Z', false, true, false, bad);
    assert.equal(rejected.value.ok, false);
    assert.equal(rejected.writes[0].today.values.length, 0);
  }
  assert.equal(fallback.writes[0].homeyAvailable['2026-09-06'], false);
  assert.equal(available.writes[0].homeyAvailable['2026-09-06'], true);
  assert.ok(fallback.writes[0].checkedAt);
  const previous = {updatedAt: '2026-09-05T14:00:00Z',
    today: {date: '2026-09-05', values: Array(96).fill(9), source: 'homey'},
    tomorrow: {date: '2026-09-06', values: Array(96).fill(-0.03), source: 'epexprijzen'}};
  const cached = await run('2026-09-06T10:00:00Z', true, true, false, null, previous);
  assert.equal(cached.value.ok, true);
  assert.equal(cached.writes[0].today.values[0], -0.03);
  assert.equal(cached.writes[0].today.source, 'epexprijzen');
  assert.equal(cached.writes[0].updatedAt, previous.updatedAt);
  assert.equal(cached.writes[0].homeyAvailable['2026-09-06'], false);
  assert.equal(cached.writes[0].cachedDays[0], '2026-09-06');
  const expired = await run('2026-09-07T10:00:00Z', true, true, false, null, previous);
  assert.equal(expired.value.ok, false);
  assert.equal(expired.writes[0].today.values.length, 0);
  console.log('PASS: missing tomorrow, both days, missing today, invalid values, Amsterdam midnight, DST and year rollover');
})().catch(error => { console.error(error); process.exitCode = 1; });
