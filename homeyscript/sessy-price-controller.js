/* Active normal-control step. Sessy - Run remains the sole device-command writer. */
const DEVICE_ID = '__SESSY_DEVICE_ID__';
const variables=Object.values(await Homey.logic.getVariables());
const one=(name,type)=>{
  const found=variables.filter(v=>v.name===name&&v.type===type);
  if(found.length!==1) throw new Error('Missing or ambiguous controller variable: '+name);
  return found[0];
};
const enabled=one('sessy_price_plan_enabled','boolean'),published=one('sessy_ready_by_17_plan','string');
const target=one('sessy_doel_vermogen','number'),saved=one('sessy_ready_by_17_state','string');
const now=new Date(),epoch=Math.floor(now.getTime()/1000);
let previous=null;try{previous=JSON.parse(published.value).forwardPlan;}catch(_){}
let result={plan:null,execution:{updatedAt:epoch,mode:'paused',reason:'disabled',targetW:0,plannedW:0,commandW:null}};
if(enabled.value===true) {
  try {result=await activeSessyStep(variables,now,DEVICE_ID,previous);}
  catch (_) {result.execution.reason='inputs-unavailable';}
}
// No smoothing after the final guard: EV starts and headroom changes must stop
// discharge/charging immediately, without carrying a previous forced target.
await Homey.logic.updateVariable({id:saved.id,variable:{value:JSON.stringify({day:localDay(now),toppingUp:false,startedMinute:null})}});
await Homey.logic.updateVariable({id:target.id,variable:{value:result.execution.targetW}});
const plan={version:1,day:localDay(now),updatedAt:epoch,enabled:enabled.value===true,
  phase:enabled.value===true?'normal':'disabled',capacityKwh:5,topUpW:1000,targetPercent:100,
  reserveMinute:540,deadlineMinute:1020,startMinute:null,
  forwardPlan:result.plan,execution:result.execution};
await Homey.logic.updateVariable({id:published.id,variable:{value:JSON.stringify(plan)}});
return {mode:result.execution.mode,reason:result.execution.reason,targetW:result.execution.targetW,
  quarters:result.plan?.intervals.length||0};
