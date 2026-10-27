import {priceDayBounds} from './charts.js';

// Presentation-only proposal: one six-elapsed-hour window per local day/night.
// Incomplete edge periods use published prices only; unknown hours stay unknown.
export function evChargingPlan(days) {
  const quarters=24,slots=[];
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  for(const day of days) {
    if(!day?.date || !Array.isArray(day.values))continue;
    const bounds=priceDayBounds(day.date);
    if(day.values.length!==bounds.count || !day.values.every(Number.isFinite))continue;
    for(let i=0;i<day.values.length;i++) {
      const from=bounds.start/1000+i*900,parts=Object.fromEntries(local.formatToParts(new Date(from*1000)).map(p=>[p.type,p.value]));
      let date=`${parts.year}-${parts.month}-${parts.day}`;
      const hour=Number(parts.hour),period=hour>=8&&hour<20?'day':'night';
      if(hour<8){const previous=new Date(`${date}T12:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);date=previous.toISOString().slice(0,10);}
      slots.push({from,until:from+900,price:day.values[i],key:`${date}:${period}`,period});
    }
  }
  slots.sort((a,b)=>a.from-b.from);
  const best=new Map();
  for(let i=0;i<=slots.length-quarters;i++) {
    const qs=slots.slice(i,i+quarters),first=qs[0];
    if(!qs.every((q,j)=>q.key===first.key&&q.from===first.from+j*900))continue;
    const cost=qs.reduce((sum,q)=>sum+q.price,0),previous=best.get(first.key);
    if(!previous || cost<previous.cost)best.set(first.key,{from:first.from,until:qs.at(-1).until,cost,period:first.period});
  }
  const windows=[...best.values()].sort((a,b)=>a.from-b.from);
  return {slots,windows};
}

export function evChargingState(plan,now=Date.now()/1000) {
  const current=plan.slots.find(q=>q.from<=now&&q.until>now);
  if(!current)return {state:'unknown',window:null};
  const window=plan.windows.find(q=>q.from<=now&&q.until>now);
  return {state:window?'allow':'wait',window:window??plan.windows.find(q=>q.from>now)??null};
}

// Record only quarters with a live charging observation; never backfill a plan.
// Session memory is deliberately bounded and disappears on reload/reboot.
export class EvChargingActivity {
  quarters = new Set();
  observe(charger, at, now = Date.now()/1000) {
    if (!Number.isFinite(at) || at > now || now-at > 45) return;
    for (const q of this.quarters) if (q < now-200*900) this.quarters.delete(q);
    if (charger?.connected === true && charger.fault === false && charger.charging === true)
      this.quarters.add(Math.floor(at/900)*900);
  }
  state(plan, slot, charger, now = Date.now()/1000) {
    if (this.quarters.has(slot.from)) return 'charging';
    const allowed = plan.windows.some(w => w.from <= slot.from && w.until >= slot.until);
    const next = plan.windows.find(w => w.until > now);
    const fresh = Number.isFinite(charger?.observedAt) && charger.observedAt <= now && now-charger.observedAt <= 45;
    if (allowed && slot.until > now && fresh && charger.connected === true && charger.fault === false &&
        charger.complete !== true && next?.from <= slot.from && next.until >= slot.until) return 'planned';
    return allowed ? 'allow' : 'wait';
  }
}
