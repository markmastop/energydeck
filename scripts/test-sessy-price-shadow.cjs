// stdin is the installer's exact bundle, not a copied planner implementation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(0,'utf8');
(async()=>{
  const epoch=Date.parse('2026-10-25T13:00:00Z')/1000;
  const bridge={today:{date:'2026-10-25',source:'homey',values:Array(100).fill(.01)},
    tomorrow:{date:'2026-10-26',source:'epexprijzen',values:Array(96).fill(.1)}};
  const sun={version:1,valid:true,source:'open-meteo',updatedAt:epoch,
    periods:Array.from({length:12},(_,i)=>({start:epoch+i*900,end:epoch+(i+1)*900,sunMinutes:7.5}))};
  const variables=[{id:'prices',name:'price-bridge',type:'string',value:JSON.stringify(bridge)},
    {id:'sun',name:'sessy_sunshine_forecast',type:'string',value:JSON.stringify(sun)}];
  let charging=false,reads=0;
  const Homey={logic:{updateVariable(){throw new Error('Shadow adapter must never write Logic');}},devices:{async getDevice({id}){
    reads++;
    if(id==='battery')return {available:true,capabilitiesObj:{measure_battery:{value:50},alarm_fault:{value:false}}};
    assert.equal(id,'charger');return {available:true,capabilitiesObj:{measure_power:{value:0},is_charging:{value:charging},alarm_device:{value:false}}};
  }}};
  const build=vm.runInNewContext(`(async function(variables,now,previous){${source}\nreturn forwardSessyPlan(variables,now,'battery',previous);})`,{Homey,Intl,Date,Math,JSON});
  const p=await build(variables,new Date(epoch*1000),null);
  assert.equal(p.mode,'shadow');assert.equal(p.inputQuality,'provisional');
  assert.equal(p.intervals[0].price,(1+9.161)*1.21+2,'Actual chart tariff conversion');
  assert.equal(p.intervals[0].sun,.5);
  assert.ok(p.inputKey.length<60,'Cache keys cannot duplicate tariff/history data into the snapshot');
  assert.ok(JSON.stringify({value:JSON.stringify({forwardPlan:p})}).length<65536,'ESP HTTP response bound');
  const cached=await build(variables,new Date((epoch+10)*1000),p);
  assert.equal(cached.updatedAt,p.updatedAt,'A cached proposal cannot renew its own freshness');
  charging=true;
  const activeEv=await build(variables,new Date((epoch+20)*1000),p);
  assert.equal(activeEv.intervals[0].ev,true);
  assert.ok(activeEv.intervals[0].powerW<=0);
  charging=undefined;
  const unknown=await build(variables,new Date((epoch+30)*1000),p);
  assert.equal(unknown.intervals[0].ev,null);assert.equal(unknown.intervals[0].powerW,0);
  assert.equal(await build([],new Date(epoch*1000),null),null);
  assert.ok(reads>=8);
  console.log('PASS: exact Homey shadow bundle, canonical tariffs, sunshine, cache freshness, EV transitions, response size and no Logic writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
