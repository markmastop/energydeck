import assert from 'node:assert/strict';
import {planSessy, sessyTarget, sessyChargeWindow} from '../homeyscript/sessy-price-planner.mjs';
import {priceDayBounds} from '../web/public/charts.js';
import {forwardBatteryPlan, batteryPlanView} from '../web/public/battery-plan.js';

const now=Date.parse('2026-10-25T22:00:00Z')/1000;
const forecast=(prices,extra={})=>prices.map((price,i)=>({from:now+i*900,until:now+(i+1)*900,
  price,houseW:900,pvW:0,ev:false,headroomW:1000,sun:null,...extra}));
const solve=(slots,soc=20,extra={})=>planSessy({now,soc,slots,...extra});
const verify=p=>{
  assert.ok(forwardBatteryPlan(p,new Date(now*1000)),'Both clients must be able to read a planner snapshot');
  for(const q of p.intervals){
    const hours=(q.until-q.from)/3600;
    assert.ok(q.powerW>=-2200 && q.powerW<=1800);
    assert.ok(q.socTo>=p.reservePercent && q.socTo<=100);
    assert.ok(q.ev===false || q.powerW<=0,'Never power an EV from the battery');
    const delta=q.socTo-q.socFrom;
    const expected=(q.powerW<0?-q.powerW*.9:-q.powerW/.95)*hours/5000*100;
    assert.ok(Math.abs(delta-expected)<.01,'Every quarter preserves the energy balance');
  }
};
// The operating floor is independent of the end-of-horizon energy target.
const lowReserve=solve(forecast(Array(8).fill(60)),10,{endReservePercent:2});
assert.equal(lowReserve.reservePercent,2);
assert.equal(lowReserve.intervals.at(-1).socTo,2,'Energy below the previous 10% floor is usable');
verify(lowReserve);
assert.equal(solve(forecast([20])).endReservePercent,20,'Preserve the terminal planning target');
const flat=solve(forecast(Array(32).fill(20))); verify(flat);
assert.ok(flat.intervals.every(q=>q.action==='hold'),'Flat prices do not create cycling');
const overnight=forecast([...Array(24).fill(10),...Array(16).fill(55)]).map((q,i)=>({...q,ev:i<24}));
const p=solve(overnight);verify(p);
assert.ok(p.intervals.slice(0,24).some(q=>q.action==='charge'),'Cheap night hours prepare for morning');
assert.ok(p.intervals.slice(24).some(q=>q.action==='discharge'),'Morning peak uses stored energy');
assert.ok(p.intervals.every(q=>q.action!=='charge'||q.powerW>=-1000));
const later=solve(forecast([...Array(8).fill(25),...Array(8).fill(65)]),50); verify(later);
assert.ok(later.intervals.slice(0,8).every(q=>q.action!=='discharge'),'Save limited energy for the more valuable later peak');
const refill=forecast([...Array(8).fill(25.5),...Array(24).fill(17),...Array(12).fill(50)])
  .map((q,i)=>({...q,ev:i>=8&&i<32,houseW:i<8?700:900}));
const conservative=solve(refill,56,{wearCt:3}),utilised=solve(refill,56,{wearCt:1.5});
verify(conservative);verify(utilised);
assert.equal(conservative.intervals[0].action,'hold');
assert.equal(utilised.intervals[0].action,'discharge','Use evening energy when cheaper refill beats losses and the selected allowance');
assert.ok(utilised.intervals.slice(8,32).some(q=>q.action==='charge'));
assert.equal(utilised.intervals[32].socFrom,conservative.intervals[32].socFrom,'Overnight replenishment restores the same morning energy despite the extra evening use');
assert.ok(utilised.intervals.at(-1).socTo>=20);
const unknown=solve(forecast(Array(24).fill(50),{ev:null,headroomW:null}),50);
assert.ok(unknown.intervals.every(q=>q.action==='hold'));
const blocked=solve(forecast(Array(24).fill(-20),{ev:true,headroomW:0}));
assert.ok(blocked.intervals.every(q=>q.action==='hold'),'No assumed charging headroom');
const solar=solve(forecast([10,10,10,10,60,60,60,60],{headroomW:0}).map((q,i)=>({...q,pvW:i<4?2000:0})),20);
assert.ok(solar.intervals.some(q=>q.action==='charge'),'Credible solar surplus can charge without grid headroom');
const negative=solve(forecast([...Array(8).fill(-20),...Array(8).fill(40)]));verify(negative);
assert.ok(negative.intervals.some(q=>q.action==='charge'));
const lost=solve(forecast([10],{headroomW:0,ev:true}),5);
assert.equal(lost.atRisk,true);assert.equal(lost.intervals[0].socTo,5,'Low reserve is reported, not invented');
for(const date of ['2026-03-29','2026-10-25']) {
  const day=priceDayBounds(date), epoch=day.start/1000;
  const qs=Array.from({length:day.count},(_,i)=>({from:epoch+i*900,until:epoch+(i+1)*900,price:20,houseW:500,pvW:0,ev:false,headroomW:1000,sun:null}));
  const dst=planSessy({now:epoch,soc:20,slots:qs});
  assert.equal(dst.intervals.length,date.includes('03-29')?92:100);
  assert.equal(dst.intervals.at(-1).until,day.end/1000);
}
const partial=forecast([10,50]);partial[0].from=now+899;
assert.doesNotThrow(()=>planSessy({now:now+899,soc:20,slots:partial}));
for(const bad of [forecast([20,30]).map((q,i)=>({...q,from:q.from+i})),forecast([NaN]),forecast([10],{houseW:null}),forecast([20],{ev:'false'})])assert.throws(()=>solve(bad));
const live={...p,mode:'active',inputQuality:'calibrated',intervals:[{...p.intervals[0],action:'charge',powerW:-1000,socFrom:50,socTo:54.5}]};
const state={available:true,fault:false,soc:50,ev:false,houseNetW:900,headroomW:1000};
assert.equal(sessyTarget(p,state,now),0,'Shadow plans cannot drive hardware');
assert.ok(sessyTarget(live,state,now)<0);
assert.equal(sessyTarget(live,{...state,ev:null},now),0);
assert.equal(sessyTarget(live,{...state,headroomW:100},now),-100);
assert.equal(sessyTarget(live,{...state,fault:true},now),0);
assert.equal(sessyTarget(live,state,now+601),0);
const discharge={...live,intervals:[{...p.intervals[0],action:'discharge',powerW:1800}]};
assert.equal(sessyTarget(discharge,{...state,ev:true},now),0);
assert.equal(sessyTarget(discharge,{...state,ev:null},now),0);
assert.equal(sessyTarget(discharge,{...state,soc:2},now),0);
assert.equal(sessyTarget(discharge,{...state,soc:3},now),900,'Discharge above the new floor');
assert.equal(sessyTarget(discharge,{...state,houseNetW:200},now),200);
assert.equal(sessyTarget({...discharge,intervals:[{...discharge.intervals[0],powerW:200}]},
  {...state,houseNetW:1400},now),1400,'Discharge follows live demand above the forecast');
assert.equal(sessyTarget(discharge,{...state,houseNetW:4000},now),1800,'Physical discharge ceiling is retained');
assert.equal(sessyTarget(discharge,{...state,houseNetW:-600},now),-600,'Actual surplus retains priority');
const view=batteryPlanView(p,new Date(now*1000));assert.equal(view.phases.length,40);
console.log('PASS: prices, overnight EV, morning/later peaks, losses, no cycling, unknown inputs, headroom, solar, negative prices, partial quarters, DST, energy balance and execution guards');

// Close the loop around a deadline, keeping expensive gaps free of grid top-up.
const rolling={mode:'active',inputQuality:'calibrated',updatedAt:now,validUntil:now+600,
  capacityKwh:5,chargeEfficiency:.9,reservePercent:2,intervals:[
    {from:now,until:now+900,action:'charge',powerW:-600,socFrom:20,socTo:22.7},
    {from:now+900,until:now+1800,action:'hold',powerW:0,socFrom:22.7,socTo:22.7},
    {from:now+1800,until:now+2700,action:'charge',powerW:-600,socFrom:22.7,socTo:25.4},
    {from:now+2700,until:now+3600,action:'discharge',powerW:500,socFrom:25.4,socTo:22.8}]};
const target=soc=>sessyTarget(rolling,{...state,soc},now);
assert.ok(Math.abs(target(20)+600)<=1);
assert.ok(target(19)<target(20),'A charging shortfall increases requested power');
assert.ok(target(22)>target(20),'Unexpected solar energy reduces grid top-up');
assert.equal(target(10),-1000,'Recovery never exceeds the grid cap');
assert.equal(target(26),0,'Stop grid charging when the window target is reached');
assert.equal(sessyChargeWindow(rolling,{soc:20},now).until,now+2700);
assert.equal(sessyChargeWindow(rolling,{soc:10},now).atRisk,true,'Report infeasible deadlines without overriding the cap');
const gap={...rolling,updatedAt:now+900,validUntil:now+1500};
assert.equal(sessyTarget(gap,{...state,soc:20},now+900),0,'Do not fill expensive gaps merely to meet the target');
// Simulate 10-second feedback with fresh plan timestamps: half delivered power
// causes compensation, and full delivery converges to the window's energy goal.
for(const fraction of [1,.5]) {
  let soc=20;
  for(let at=now;at<now+2700;at+=10) {
    const livePlan={...rolling,updatedAt:at,validUntil:at+600};
    const watts=sessyTarget(livePlan,{...state,soc},at);
    assert.ok(watts<=0&&watts>=-1000);
    soc+=-watts*fraction*10/3600*.9/5000*100;
  }
  if(fraction===1)assert.ok(Math.abs(soc-25.4)<.02);
  else assert.ok(soc>22.7,'Feedback improves on blindly delivering half the fixed setpoint');
}
assert.ok(Math.abs(sessyTarget(rolling,{...state,soc:20,ev:true,houseNetW:-1500,siteNetW:500},now)+600)<=1,
  'EV consumption is not spare solar: grid top-up remains capped');
assert.equal(sessyTarget(rolling,{...state,soc:20,siteNetW:-1800},now),-1800,'Actual whole-site solar surplus may exceed 1 kW');
console.log('PASS: rolling charge deadline, SoC feedback, cheap gaps, shortfall recovery, full-target stop and whole-site solar');
