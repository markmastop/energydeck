import test from 'node:test';
import assert from 'node:assert/strict';
import { priceDay } from '../data.mjs';
import { priceDayBounds, priceQuarter, priceTime, priceWindow } from '../public/charts.js';
const config = {tax:0,vat:0,fee:0};
const day = date => ({date,values:Array.from({length:priceDayBounds(date).count},(_,i)=>i)});

test('price days validate the actual 92/96/100 calendar quarters, including cache rollover', () => {
  for (const [date,count] of [['2026-03-29',92],['2026-10-25',100],['2026-10-26',96]]) {
    const data = day(date);
    const result = priceDay({tomorrow:data},date,config);
    assert.equal(result.values.length,count);
    assert.equal(result.average,(count-1)*50);
    assert.equal(result.end-result.start,count*900000);
    for (const invalid of [92,95,96,97,100]) {
      if (invalid===count) continue;
      assert.equal(priceDay({today:{date,values:Array(invalid).fill(1)}},date,config),null);
    }
    const negative = {date,values:Array(count).fill(-1)};
    assert.equal(priceDay({today:negative},date,config).minimum,-100);
    data.values.fill(2);data.values.fill(-1,count-12);
    assert.equal(priceDay({today:data},date,config).cheapest,count-12);
  }
});

test('current quarters skip spring hour and distinguish both autumn 02:00 hours', () => {
  const spring = day('2026-03-29'), autumn = day('2026-10-25');
  assert.equal(priceQuarter(spring,Date.parse('2026-03-29T00:45:00Z')),7);
  assert.equal(priceQuarter(spring,Date.parse('2026-03-29T01:00:00Z')),8);
  assert.equal(priceTime(Date.parse('2026-03-29T01:00:00Z')),'03:00');
  assert.equal(priceQuarter(autumn,Date.parse('2026-10-25T00:00:00Z')),8);
  assert.equal(priceQuarter(autumn,Date.parse('2026-10-25T01:00:00Z')),12);
  assert.equal(priceQuarter(autumn,Date.parse('2026-10-25T22:45:00Z')),99);
  assert.equal(priceQuarter(spring,Date.parse('2026-03-29T21:45:00Z')),91);
  assert.match(priceTime(Date.parse('2026-10-25T00:00:00Z'),true),/02:00 GMT\+2/);
  assert.match(priceTime(Date.parse('2026-10-25T01:00:00Z'),true),/02:00 GMT\+1/);
});

test('noon windows preserve all actual quarters before and after both DST changes', () => {
  for (const [date,next] of [['2026-03-28','2026-03-29'],['2026-03-29','2026-03-30'],['2026-10-24','2026-10-25'],['2026-10-25','2026-10-26']]) {
    const today = day(date), tomorrow = day(next), noon = today.values.length-48;
    assert.equal(priceWindow(today,tomorrow,noon-1).offset,0);
    assert.equal(priceWindow(today,null,noon).values.length,today.values.length);
    const window = priceWindow(today,tomorrow,noon);
    assert.equal(window.offset,noon);
    assert.equal(window.values.length,tomorrow.values.length);
    assert.equal(priceTime(window.start),'12:00');
    assert.equal(priceTime(window.start+window.values.length*900000),'12:00');
    assert.deepEqual(window.values,[...today.values.slice(noon),...tomorrow.values.slice(0,tomorrow.values.length-48)]);
    assert.equal(window.values[today.values.length-1-noon],today.values.at(-1));
    const shifted = priceWindow(today,tomorrow,today.values.length-1);
    assert.equal(shifted.values[today.values.length-1-shifted.offset],today.values.at(-1));
    assert.equal(shifted.average,shifted.values.reduce((a,b)=>a+b,0)/shifted.values.length);
  }
});

test('cheapest three hours use elapsed time when the chosen block crosses DST', () => {
  for (const [date,endTime] of [['2026-03-29','05:00'],['2026-10-25','03:00']]) {
    const data = day(date);data.values.fill(1);data.values.fill(-1,4,16);
    const window = priceWindow(data,null,0);
    assert.equal(window.cheapest,4);
    assert.equal(priceTime(window.start+window.cheapest*900000),'01:00');
    assert.equal(priceTime(window.start+(window.cheapest+12)*900000),endTime);
  }
});
