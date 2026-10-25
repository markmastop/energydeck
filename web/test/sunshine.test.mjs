import test from 'node:test';
import assert from 'node:assert/strict';
import { sunshineSeries, sunshineFraction } from '../public/sunshine.js';
import { createExtrasService } from '../extras.mjs';

const now = new Date('2026-10-25T00:55:00Z');
const end = Date.parse('2026-10-25T01:00:00Z') / 1000;
const raw = () => ({ minutely_15_units: { sunshine_duration: 's' },
  minutely_15: { time: [end, end + 900], sunshine_duration: [450, 900] } });

test('sunshine refers to the preceding quarter and weights five-minute overlap across DST', () => {
  const series = sunshineSeries(raw(), now);
  assert.equal(sunshineFraction(series, now.getTime(), now.getTime() + 300000, now.getTime()), .5);
  // This five-minute interval straddles two quarters and the repeated local hour.
  assert.equal(sunshineFraction(series, end * 1000 - 150000, end * 1000 + 150000, now.getTime()), .75);
  assert.equal(sunshineFraction(series, (end + 900) * 1000, (end + 1200) * 1000, now.getTime()), null);
});

test('zero sunshine is valid; missing, stale or malformed sunshine is unknown', () => {
  const input = raw(); input.minutely_15.sunshine_duration = [0, 0];
  const series = sunshineSeries(input, now), from = now.getTime(), until = from + 300000;
  assert.equal(sunshineFraction(series, from, until, from), 0);
  assert.equal(sunshineFraction(series, from, until, from + 2700001), null);
  assert.equal(sunshineFraction(series, from, until, from - 30001), null);
  assert.equal(sunshineFraction(null, from, until, from), null);
  for (const bad of [null, -1, 901, '450']) {
    const invalid = raw(); invalid.minutely_15.sunshine_duration[0] = bad;
    assert.equal(sunshineSeries(invalid, now), null);
  }
  const gap = raw(); gap.minutely_15.time[1] += 900;
  assert.equal(sunshineSeries(gap, now), null);
  const units = raw(); units.minutely_15_units.sunshine_duration = 'minutes';
  assert.equal(sunshineSeries(units, now), null);
});

test('UTC overlap remains continuous across midnight', () => {
  const input = raw(), midnight = Date.parse('2026-10-26T00:00:00Z') / 1000;
  input.minutely_15.time = [midnight, midnight + 900];
  const current = new Date(midnight * 1000 - 150000);
  assert.equal(sunshineFraction(sunshineSeries(input, current), current.getTime(), current.getTime() + 300000, current.getTime()), .75);
});

test('two-hour summary distinguishes sunny minutes, known zero and incomplete coverage', () => {
  const start = now.getTime(), input = raw();
  input.minutely_15.time = Array.from({length:10}, (_,i) => end + i * 900);
  input.minutely_15.sunshine_duration = Array(10).fill(225);
  assert.equal(sunshineFraction(sunshineSeries(input, now), start, start + 7200000, start) * 120, 30);
  input.minutely_15.sunshine_duration.fill(0);
  assert.equal(sunshineFraction(sunshineSeries(input, now), start, start + 7200000, start), 0);
  input.minutely_15.time.length = input.minutely_15.sunshine_duration.length = 8;
  assert.equal(sunshineFraction(sunshineSeries(input, now), start, start + 7200000, start), null);
});

test('weather preserves simultaneous rain and sunshine from independent sources', async () => {
  let openMeteoRequests = 0;
  const service = createExtrasService({ latitude: 52, longitude: 5 }, async url => {
      if (String(url).includes('open-meteo')) {
        openMeteoRequests++;
        assert.equal(new URL(url).searchParams.get('minutely_15'), 'sunshine_duration');
        return new Response(JSON.stringify(raw()));
      }
      return new Response(Array.from({length:25}, (_,i) => {
        const minutes = 2 * 60 + 55 + i * 5;
        return `150|${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
      }).join('\n'));
    }, () => now);
  const weather = await service.weather();
  assert.ok(weather.rain.points[0].value > 0);
  assert.equal(sunshineFraction(weather.sunshine, weather.rain.points[0].time, weather.rain.points[0].time + 300000, now.getTime()), .5);
  assert.equal(openMeteoRequests, 1);
});
