import test from 'node:test';
import assert from 'node:assert/strict';
import {priceDayBounds} from '../public/charts.js';
import {evChargingPlan,evChargingState} from '../public/ev-plan.js';
const day=(date,price=30)=>({date,values:Array(priceDayBounds(date).count).fill(price)});
const hour=at=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date(at*1000)));

test('daytime gets a charging opportunity even when night prices are much cheaper',()=>{
 const d=day('2026-10-26'),start=priceDayBounds(d.date).start/1000;
 d.values.fill(1,0,32);d.values.fill(20,48,60);
 const p=evChargingPlan([d]);
 const daytime=p.windows.find(q=>q.period==='day');
 assert.equal(daytime.from,start+48*900);
 assert.equal(daytime.until-daytime.from,10800);
 assert.equal(evChargingState(p,start+50*900).state,'allow');
 assert.equal(evChargingState(p,start+40*900).state,'wait');
});

test('one night window spans midnight without duplicating day-specific windows',()=>{
 const a=day('2026-10-26'),b=day('2026-10-27');
 a.values.fill(0,92);b.values.fill(0,0,8);
 const p=evChargingPlan([a,b]);
 const midnight=priceDayBounds(b.date).start/1000;
 assert.ok(p.windows.some(q=>q.from===midnight-3600&&q.until===midnight+7200));
 assert.equal(p.windows.filter(q=>q.period==='night'&&q.from>=midnight-4*3600&&q.from<midnight+8*3600).length,1);
});

for(const date of ['2026-03-29','2026-10-25'])test(`DST ${date}: three elapsed hours within local periods`,()=>{
 const d=day(date),p=evChargingPlan([d]);
 assert.equal(p.slots.length,priceDayBounds(date).count);
 for(const q of p.windows){assert.equal(q.until-q.from,10800);const h=hour(q.from),last=hour(q.until-1);assert.equal(h>=8&&h<20,last>=8&&last<20);}
});

test('missing and invalid prices remain unknown; equal-price windows choose the earliest',()=>{
 assert.deepEqual(evChargingPlan([null]).windows,[]);
 const d=day('2026-10-26');d.values.pop();assert.equal(evChargingPlan([d]).slots.length,0);
 const p=evChargingPlan([day('2026-10-26')]);
 assert.equal(evChargingState(p,p.slots.at(-1).until).state,'unknown');
 assert.equal(hour(p.windows.find(q=>q.period==='day').from),8);
 d.values=Array(96).fill(NaN);assert.equal(evChargingPlan([d]).slots.length,0);
});
