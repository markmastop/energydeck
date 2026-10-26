import {batterySunshine} from './sunshine.js';
import {priceDayBounds} from './charts.js';
import {batteryPlanView, batterySocView, forwardClock} from './battery-plan.js';

// Both plots use UTC bounds from the controller, including partial quarters and
// repeated DST hours. Unknown/stale proposals never become an empty zero graph.
export function batteryDetailModel(raw, now = new Date(), selection = null) {
  const view=batteryPlanView(raw,now);
  if(view.plan?.version!==2) return null;
  const qs=view.plan.intervals;
  const chosen=selection===null?-1:qs.findIndex(q=>q.from<=selection && q.until>selection);
  const index=chosen<0?qs.indexOf(view.current):chosen;
  const socPoints=[{at:qs[0].from,percentage:qs[0].socFrom},...qs.map(q=>({at:q.until,percentage:q.socTo}))];
  return {...view,index,selected:qs[index],socPoints,minimum:Math.min(0,...qs.map(q=>q.price)),maximum:Math.max(1,...qs.map(q=>q.price)),powerMaximum:2500};
}

// Published calendar prices fill the past; forecast power is never copied back.
export function batteryDetailTimeline(m, history, prices, now, selection=null) {
  const epoch=now.getTime()/1000;
  const fresh=history?.points?.length>0 && history.start<=now.getTime() && history.end>now.getTime();
  let from=fresh?Math.min(m.from,history.start/1000):m.from;
  const bars=[];
  for(const day of [prices?.today,prices?.tomorrow]) {
    if(!day?.date || !Array.isArray(day.values))continue;
    const bounds=priceDayBounds(day.date);
    if(day.values.length!==bounds.count || !day.values.every(Number.isFinite))continue;
    for(let i=0;i<day.values.length;i++) {
      const a=Math.max(fresh?from:Math.min(m.from,bounds.start/1000),bounds.start/1000+i*900),b=Math.min(m.from,bounds.start/1000+(i+1)*900);
      if(b>a)bars.push({from:a,until:b,price:day.values[i]});
    }
  }
  if(bars.length)from=Math.min(from,bars[0].from);
  const at=Math.min(m.until-1,Math.max(from,selection??epoch));
  bars.push(...m.plan.intervals);
  const part=m.plan.intervals.find(q=>q.from<=at && q.until>at);
  const price=bars.find(q=>q.from<=at && q.until>at)?.price??null;
  const soc=batterySocView(history,null,from,m.until,null,now);
  // An isolated exact sample is usable even when adjacent gaps cannot be joined.
  let measured=fresh && history.points.length<=310 ? history.points.find(p=>p.time/1000===at &&
    at<=epoch && p.time>=history.start && p.time<history.end && Number.isFinite(p.value) && p.value>=0 && p.value<=100)?.value??null : null;
  for(const [a,b] of soc.measured)if(a.at<=at && b.at>=at)measured=a.soc+(b.soc-a.soc)*(at-a.at)/(b.at-a.at);
  const ticks=[],step=m.until-from>30*3600?12:6;
  const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',hourCycle:'h23',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
  for(let t=Math.ceil(from/3600)*3600;t<=m.until;t+=3600) {
    const parts=Object.fromEntries(local.formatToParts(new Date(t*1000)).map(p=>[p.type,p.value]));
    if(Number(parts.hour)%step || Number(parts.minute))continue;
    ticks.push({at:t,text:Number(parts.hour)===0?`${parts.day}/${parts.month}`:`${parts.hour}:00`});
  }
  return {from,at,part:at>=epoch?part:null,price,measured,bars,ticks,
    minimum:Math.min(0,...bars.map(q=>q.price)),maximum:Math.max(1,...bars.map(q=>q.price)),
    colorLow:Math.min(...bars.map(q=>q.price)),colorHigh:Math.max(...bars.map(q=>q.price))};
}

export function initializeBatteryDetail({t,format}) {
  const $=id=>document.getElementById(id),svg=$('battery-comparison'),slider=$('battery-detail-selection');
  let selected=null,last=null,viewportFrom=null;
  const ns='http://www.w3.org/2000/svg';
  const node=(name,attrs,content)=>{const n=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(content!==undefined)n.textContent=content;return n;};
  function render(battery,now=new Date(),prices=last?.prices,sunshine=last?.sunshine) {
    last={battery,prices,sunshine};
    const m=batteryDetailModel(battery?.plan,now,selected),live=battery?.power;
    const clock=epoch=>forwardClock(epoch,now,document.documentElement.lang||'nl');
    $('battery-detail-live').textContent=`${t('batteryMeasuredNow')}: ${t(live>20?'batteryActiondischarge':live < -20?'batteryActioncharge':'batteryActionhold')} · ${format(live===null?null:Math.abs(live),0)} W · ${format(battery?.percentage,0)}%`;
    $('battery-detail-status').textContent=m?t(m.plan.mode==='shadow'?'batteryShadow':'batteryActivePlan'):t('batteryPlanUnavailable');
    if(m?.plan.execution) $('battery-detail-status').textContent+=` · ${t('batteryControl'+m.plan.execution.reason)}`;
    slider.disabled=!m;
    if(!m){svg.replaceChildren();$('battery-detail-selected').textContent=t('batteryPlanUnavailable');$('battery-detail-note').textContent='';return;}
    const history=battery?.history,timeline=batteryDetailTimeline(m,history,prices,now,selected);
    const {from,at,part:q}=timeline;
    viewportFrom=from;
    slider.max=Math.ceil((m.until-from)/60);slider.value=Math.round((at-from)/60);
    slider.setAttribute('aria-valuetext',clock(at));
    const chosen=`${t('batterySelected')}: ${clock(at)} · ${format(timeline.price)} ct/kWh`;
    const expected=q?`${t(`batteryAction${q.action}`)} · ${t('batteryExpectedPower')} ${format(Math.abs(q.powerW)/1000)} kW · ${format(q.socFrom+(q.socTo-q.socFrom)*(at-q.from)/(q.until-q.from),0)}%`:
      timeline.measured!==null?`${t('batteryMeasured')}: ${format(timeline.measured,0)}%`:t('batteryHistoryMissing');
    $('battery-detail-selected').textContent=`${chosen} · ${expected}`;
    $('battery-detail-note').textContent=[m.plan.inputQuality==='provisional'?t('batteryAssumptions'):t('batteryCalibrated'),m.plan.atRisk?t('batteryTargetRisk'):'',q && q.ev!==false?t('batteryEvProtected'):''].filter(Boolean).join(' · ');
    const x=epoch=>62+(epoch-from)/(m.until-from)*578;
    const py=price=>192-(price-timeline.minimum)/(timeline.maximum-timeline.minimum)*140;
    const wy=watts=>337-watts/m.powerMaximum*70;
    const marks=[];
    const label=(xx,yy,text,anchor='start',color='var(--muted)')=>marks.push(node('text',{x:xx,y:yy,'text-anchor':anchor,fill:color},text));
    label(62,30,t('prices'));label(640,30,'ct/kWh','end');
    label(62,255,t('batteryBehaviour'));label(640,255,'kW','end');
    for(const v of [timeline.minimum,(timeline.minimum+timeline.maximum)/2,timeline.maximum]){
      marks.push(node('line',{x1:62,x2:640,y1:py(v),y2:py(v),stroke:'var(--border)'}));label(52,py(v)+7,format(v,0),'end');
    }
    for(const v of [-2500,0,2500]){
      marks.push(node('line',{x1:62,x2:640,y1:wy(v),y2:wy(v),stroke:'var(--border)'}));label(52,wy(v)+7,format(v/1000),'end');
    }
    for(const bar of timeline.bars){
      const left=x(bar.from),width=Math.max(.5,x(bar.until)-left-.7);
      const fraction=(bar.price-timeline.colorLow)/Math.max(.001,timeline.colorHigh-timeline.colorLow);
      const color=fraction<=.33?'#48BD70':fraction>=.66?'#EA665F':'#E8B94C';
      marks.push(node('rect',{x:left,y:Math.min(py(bar.price),py(0)),width,height:Math.max(1,Math.abs(py(bar.price)-py(0))),fill:color}));
    }
    if(from<m.from && !timeline.bars.some(q=>q.from<m.from))label(70,80,t('batteryPriceHistoryMissing'));
    for(const part of m.plan.intervals){
      const left=x(part.from),width=Math.max(.5,x(part.until)-left-.7),color=part.action==='charge'?'var(--blue)':part.action==='discharge'?'#e7a052':'#617064';
      marks.push(node('rect',{x:left,y:Math.min(wy(part.powerW),wy(0)),width,height:Math.max(1,Math.abs(wy(part.powerW)-wy(0))),fill:color}));
      const sun=batterySunshine(sunshine,part.from,part.until,part.sun,now.getTime());
      if(sun!==null)marks.push(node('rect',{x:left,y:259,width:sun>0?Math.max(1,width*sun):width,height:sun>0?6:2,fill:sun>0?'#FFD35A':'#617064'}));
    }
    // Predicted SoC uses its own 0–100% scale, independently of signed watts.
    const sy=percent=>407-percent/100*140;
    for(const percent of [0,50,100])label(646,sy(percent)+7,`${percent}%`,'start','#48BD70');
    const soc=batterySocView(history,battery.plan,from,m.until,battery.percentage,now);
    for(const [a,b] of soc.measured) marks.push(node('line',{x1:x(a.at),x2:x(b.at),y1:sy(a.soc),y2:sy(b.soc),stroke:'#48bd70','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    marks.push(node('polyline',{points:soc.predicted.map(p=>`${x(p.at)},${sy(p.soc)}`).join(' '),fill:'none',stroke:'#48BD70','stroke-width':2,'stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke','aria-label':t('batteryExpectedSoc')}));
    for(const tick of timeline.ticks){
      const anchor=x(tick.at)<102?'start':x(tick.at)>600?'end':'middle';
      for(const y of [220,440])label(x(tick.at),y,tick.text,anchor);
    }
    for(const [epoch,color] of [[now.getTime()/1000,'#617064'],[at,'var(--text)']]){
      for(const [a,b]of [[52,192],[267,407]])marks.push(node('line',{x1:x(epoch),x2:x(epoch),y1:a,y2:b,stroke:color,'stroke-width':2}));
    }
    // Historical SoC is measured; past power is still unavailable in this plot.
    if(typeof live==='number' && Number.isFinite(live)) marks.push(node('circle',{cx:x(now.getTime()/1000),cy:wy(Math.max(-2500,Math.min(2500,live))),r:5,fill:'var(--text)',stroke:'var(--panel)','stroke-width':2}));
    svg.replaceChildren(...marks);
  }
  slider.addEventListener('input',()=>{
    const m=batteryDetailModel(last?.battery?.plan);if(!m)return;
    selected=Math.min(m.until-1,(viewportFrom??m.from)+Number(slider.value)*60);render(last.battery,new Date(),last.prices);
  });
  svg.addEventListener('click',event=>{
    const m=batteryDetailModel(last?.battery?.plan);if(!m)return;
    const x=(event.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*720;
    selected=Math.min(m.until-1,Math.max(viewportFrom??m.from,(viewportFrom??m.from)+(x-62)/578*(m.until-(viewportFrom??m.from))));render(last.battery,new Date(),last.prices);
  });
  return {render,reset(){selected=null;last=null;svg.replaceChildren();}};
}
