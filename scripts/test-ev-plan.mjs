// Compare both production planners, including negative prices and DST nights.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {evChargingPlan} from '../web/public/ev-plan.js';
import {priceDayBounds} from '../web/public/charts.js';
const tmp=mkdtempSync(join(tmpdir(),'energydeck-ev-'));
try {
 const bin=join(tmp,'ev-plan');execFileSync('c++',['-std=c++17','scripts/test-ev-plan.cpp','-o',bin]);
 for(const date of ['2026-03-29','2026-10-25','2026-10-26']) {
  const a=priceDayBounds(date),next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  const tomorrow=next.toISOString().slice(0,10);
  const js=evChargingPlan([{date,values:Array.from({length:a.count},(_,i)=>(i*13)%31-5)},
   {date:tomorrow,values:Array.from({length:priceDayBounds(tomorrow).count},(_,i)=>(i*7)%23-3)}]);
  const native=execFileSync(bin,[String(a.start/1000),String(a.count)],{encoding:'utf8'}).trim().split('\n').map(r=>r.split(' ').map(Number));
  assert.deepEqual(native,js.windows.map(q=>[q.from,q.until]));
 }
 console.log('EV web/ESP parity passed for regular, 23-hour and 25-hour days.');
} finally {rmSync(tmp,{recursive:true,force:true});}
