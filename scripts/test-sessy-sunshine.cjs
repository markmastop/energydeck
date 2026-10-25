const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/../homeyscript/sessy-sunshine-forecast.js`, 'utf8')
  .replace('__LATITUDE__', '52').replace('__LONGITUDE__', '5');
async function run(instant, options = {}) {
  const epoch = Date.parse(instant)/1000, first = Math.floor(epoch/900)*900;
  const vars = {
    cache:{id:'cache',name:'sessy_sunshine_forecast',type:'string',value:'{}'},
    legacy:{id:'legacy',name:'ExpectedSunshineMinutes',type:'number',value:0},
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const payload = options.payload || {minutely_15_units:{sunshine_duration:'s'}, minutely_15:{
    time:Array.from({length:17},(_,i)=>first+i*900), sunshine_duration:Array(17).fill('seconds' in options ? options.seconds : 30)}};
  const context = {Date:FixedDate, URLSearchParams, Homey:{logic:{
    getVariables:async()=>structuredClone(vars), updateVariable:async({id,variable})=>{vars[id].value=variable.value;},
  }}, fetch:async url=>{
    assert.match(url,/timeformat=unixtime/); assert.match(url,/minutely_15=sunshine_duration/);
    if (options.fail) throw new Error('offline');
    return {ok:true,json:async()=>payload};
  }};
  try { return {result:await vm.runInNewContext(`(async()=>{${source}\n})()`,context),vars}; }
  catch(error) { return {error,vars}; }
}
(async()=>{
  for(const instant of ['2026-10-25T00:37:00Z','2026-10-25T01:37:00Z','2026-10-25T23:57:00Z']) {
    const r=await run(instant); assert.equal(r.result.sunshineMinutes,6,
      'Thirty seconds per quarter is six minutes over three hours, even when all values are below 60');
    const f=JSON.parse(r.vars.cache.value);assert.equal(f.valid,true);
    assert.ok(f.periods[0].start<=Date.parse(instant)/1000);
    assert.ok(f.periods.at(-1).end>=Date.parse(instant)/1000+10800);
  }
  assert.equal((await run('2026-10-25T10:00:00Z',{seconds:900})).result.sunshineMinutes,180);
  const instant='2026-10-25T10:07:00Z', epoch=Date.parse(instant)/1000, first=Math.floor(epoch/900)*900;
  const long={minutely_15_units:{sunshine_duration:'s'},minutely_15:{
    time:Array.from({length:149},(_,i)=>first+i*900),sunshine_duration:Array(149).fill(450)}};
  const future=await run(instant,{payload:long});
  const forecast=JSON.parse(future.vars.cache.value);
  assert.ok(forecast.periods.length<=16,'Existing short-horizon readers keep their bound');
  assert.equal(forecast.forwardPeriods.length,145);
  assert.ok(forecast.forwardPeriods.at(-1).end>=epoch+36*3600,'Tomorrow sunshine is included');
  long.minutely_15.sunshine_duration[80]=null;
  const missing=await run(instant,{payload:long});
  assert.equal(missing.result.sunshineMinutes,90,'Missing distant weather cannot break the current controller');
  assert.ok(JSON.parse(missing.vars.cache.value).forwardPeriods.length<80,'Future missing data truncates coverage');
  for(const options of [{fail:true},{seconds:null},{seconds:901},{payload:{minutely_15_units:{sunshine_duration:'min'}}}]) {
    const r=await run('2026-10-25T10:00:00Z',options);assert.ok(r.error);assert.equal(JSON.parse(r.vars.cache.value).valid,false);
  }
  console.log('PASS: sunshine seconds, partial quarters, midnight, repeated DST hours, units, coverage and failure invalidation');
})().catch(error=>{console.error(error);process.exitCode=1;});
