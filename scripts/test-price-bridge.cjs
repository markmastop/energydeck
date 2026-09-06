// Run the actual HomeyScript with a mocked Homey API; no network or Flow calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../homeyscript/energydeck-prices.js'), 'utf8');

async function run(instant, failTomorrow = false, failToday = false, invalid = false) {
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
      async getVariables() { return { existing: { id: 'existing', name: 'EnergyDeck Prices' } }; },
      async updateVariable({ id, variable }) { writes.push(JSON.parse(variable.value)); return { id }; },
    },
  };
  const result = await vm.runInNewContext(`(async () => {${source}\n})()`, {
    Homey, Date: FixedDate, Intl, log: message => logs.push(message),
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
    assert.equal(r.value.warnings.length, 1);
    assert.match(r.logs.join('\n'), new RegExp(tomorrow));
  }
  const available = await run('2026-09-06T10:00:00Z');
  assert.equal(available.writes[0].tomorrow.values.length, 96);
  assert.equal(available.value.warnings.length, 0);
  const missing = await run('2026-09-06T10:00:00Z', false, true);
  assert.match(missing.error.message, /2026-09-06.*NotFoundError/);
  assert.equal(missing.writes.length, 0);
  const invalid = await run('2026-09-06T10:00:00Z', false, false, true);
  assert.match(invalid.error.message, /finite numeric/);
  assert.equal(invalid.writes.length, 0);
  console.log('PASS: missing tomorrow, both days, missing today, invalid values, Amsterdam midnight, DST and year rollover');
})().catch(error => { console.error(error); process.exitCode = 1; });
