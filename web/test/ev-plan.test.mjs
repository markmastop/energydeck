import test from 'node:test';
import assert from 'node:assert/strict';
import {priceDayBounds} from '../public/charts.js';
import {evChargingPlan,evChargingState,EvChargingActivity} from '../public/ev-plan.js';
const day=(date,price=30)=>({date,values:Array(priceDayBounds(date).count).fill(price)});
const hour=at=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'}).format(new Date(at*1000)));

test('daytime gets a charging opportunity even when night prices are much cheaper',()=>{
 const d=day('2026-10-26'),start=priceDayBounds(d.date).start/1000;
 d.values.fill(1,0,32);d.values.fill(20,48,72);
 const p=evChargingPlan([d]);
 const daytime=p.windows.find(q=>q.period==='day');
 assert.equal(daytime.from,start+48*900);
 assert.equal(daytime.until-daytime.from,21600);
 assert.equal(evChargingState(p,start+50*900).state,'allow');
 assert.equal(evChargingState(p,start+40*900).state,'wait');
});

test('one night window spans midnight without duplicating day-specific windows',()=>{
 const a=day('2026-10-26'),b=day('2026-10-27');
 a.values.fill(0,88);b.values.fill(0,0,16);
 const p=evChargingPlan([a,b]);
 const midnight=priceDayBounds(b.date).start/1000;
 assert.ok(p.windows.some(q=>q.from===midnight-7200&&q.until===midnight+14400));
 assert.equal(p.windows.filter(q=>q.period==='night'&&q.from>=midnight-4*3600&&q.from<midnight+8*3600).length,1);
});

for(const date of ['2026-03-29','2026-10-25'])test(`DST ${date}: six elapsed hours within local periods`,()=>{
 const d=day(date),p=evChargingPlan([d]);
 assert.equal(p.slots.length,priceDayBounds(date).count);
 for(const q of p.windows){assert.equal(q.until-q.from,21600);const h=hour(q.from),last=hour(q.until-1);assert.equal(h>=8&&h<20,last>=8&&last<20);}
});

test('missing and invalid prices remain unknown; equal-price windows choose the earliest',()=>{
 assert.deepEqual(evChargingPlan([null]).windows,[]);
 const d=day('2026-10-26');d.values.pop();assert.equal(evChargingPlan([d]).slots.length,0);
 const p=evChargingPlan([day('2026-10-26')]);
 assert.equal(evChargingState(p,p.slots.at(-1).until).state,'unknown');
 assert.equal(hour(p.windows.find(q=>q.period==='day').from),8);
 d.values=Array(96).fill(NaN);assert.equal(evChargingPlan([d]).slots.length,0);
});

test('a partial published evening cannot be presented as a full six-hour window',()=>{
 const d=day('2026-10-26'),p=evChargingPlan([d]);
 const evening=priceDayBounds(d.date).end/1000-4*3600;
 assert.ok(!p.windows.some(q=>q.from>=evening));
 for(const q of p.windows)assert.equal(q.until-q.from,21600);
});

test('separate cheap fragments never replace one continuous six-hour window',()=>{
 const d=day('2026-10-26',50),start=priceDayBounds(d.date).start/1000;
 d.values.fill(1,32,44);d.values.fill(1,68,80);
 const p=evChargingPlan([d]),w=p.windows.find(q=>q.period==='day');
 assert.equal(w.from,start+32*900);assert.equal(w.until,start+56*900);
 assert.equal(evChargingState(p,start+48*900).state,'allow');
 assert.equal(evChargingState(p,start+72*900).state,'wait');
});

test('connected cars fill only the next remaining window green; missing, faulted and completed cars do not',()=>{
 const plan=evChargingPlan([day('2026-10-26')]),now=plan.slots[0].from;
 const activity=new EvChargingActivity(),first=plan.slots[0],later=plan.slots[32];
 const car={connected:true,fault:false,charging:false,complete:false,observedAt:now};
 assert.equal(activity.state(plan,first,car,now),'planned');
 assert.equal(activity.state(plan,later,car,now),'waiting');
 for(const override of [{connected:false},{connected:null},{fault:true},{fault:null},{complete:true},{observedAt:now-46},{observedAt:now+1}])
   assert.equal(activity.state(plan,first,{...car,...override},now),'allow');
 assert.equal(activity.state(plan,first,car,first.until),'allow');
 assert.equal(activity.state(plan,plan.slots[24],car,now),'waiting');
});

test('observed charging overrides price advice without inventing history or future charging',()=>{
 const plan=evChargingPlan([day('2026-10-26')]),slot=plan.slots[24],now=slot.from+20;
 const activity=new EvChargingActivity(),car={connected:true,fault:false,charging:true,observedAt:now};
 assert.equal(activity.state(plan,slot,car,now),'waiting');
 for(const override of [{connected:false},{fault:true},{charging:null}]) activity.observe({...car,...override},now,now);
 activity.observe(car,now-46,now);activity.observe(car,now+1,now);
 assert.equal(activity.state(plan,slot,car,now),'waiting');
 activity.observe(car,now,now);
 assert.equal(activity.state(plan,slot,car,now),'charging');
 assert.equal(activity.state(plan,slot,{connected:false},now+900),'charging');
 assert.equal(activity.state(plan,plan.slots[25],car,now),'waiting');
 assert.equal(new EvChargingActivity().state(plan,slot,car,now),'waiting');
 activity.observe(null,now+201*900,now+201*900);
 assert.equal(activity.quarters.size,0);
});
