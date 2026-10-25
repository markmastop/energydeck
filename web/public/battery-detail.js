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

export function initializeBatteryDetail({t,format}) {
  const $=id=>document.getElementById(id),svg=$('battery-comparison'),slider=$('battery-detail-selection');
  let selected=null,last=null,viewportFrom=null;
  const ns='http://www.w3.org/2000/svg';
  const node=(name,attrs,content)=>{const n=document.createElementNS(ns,name);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(content!==undefined)n.textContent=content;return n;};
  function render(battery,now=new Date()) {
    last=battery;
    const m=batteryDetailModel(battery?.plan,now,selected),live=battery?.power;
    const clock=epoch=>forwardClock(epoch,now,document.documentElement.lang||'nl');
    $('battery-detail-live').textContent=`${t('batteryMeasuredNow')}: ${format(battery?.percentage,0)}% · ${format(live===null?null:live/1000)} kW`;
    $('battery-detail-status').textContent=m?t(m.plan.mode==='shadow'?'batteryShadow':'batteryActivePlan'):t('batteryPlanUnavailable');
    if(m?.plan.execution) $('battery-detail-status').textContent+=` · ${t('batteryControl'+m.plan.execution.reason)}`;
    slider.disabled=!m;
    if(!m){svg.replaceChildren();$('battery-detail-selected').textContent=t('batteryPlanUnavailable');$('battery-detail-note').textContent='';return;}
    slider.max=m.plan.intervals.length-1;slider.value=m.index;
    const q=m.selected,action=t(`batteryAction${q.action}`);
    slider.setAttribute('aria-valuetext',`${clock(q.from)} · ${action}`);
    $('battery-detail-selected').textContent=`${clock(q.from)} · ${format(q.price)} ct/kWh · ${action} ${format(Math.abs(q.powerW)/1000)} kW · ${t('batteryExpected')} ${format(q.socTo,0)}%`;
    $('battery-detail-note').textContent=[m.plan.inputQuality==='provisional'?t('batteryAssumptions'):t('batteryCalibrated'),m.plan.atRisk?t('batteryTargetRisk'):'',q.ev!==false?t('batteryEvProtected'):''].filter(Boolean).join(' · ');
    const history=battery?.history;
    const fresh=history?.points?.length>0 && history.start<=now.getTime() && history.end>now.getTime();
    const from=fresh?Math.min(m.from,history.start/1000):m.from;
    viewportFrom=from;
    const x=epoch=>62+(epoch-from)/(m.until-from)*578;
    const py=price=>192-(price-m.minimum)/(m.maximum-m.minimum)*140;
    const wy=watts=>337-watts/m.powerMaximum*70;
    const marks=[];
    const label=(xx,yy,text,anchor='start',color='var(--muted)')=>marks.push(node('text',{x:xx,y:yy,'text-anchor':anchor,fill:color},text));
    label(62,30,t('prices'));label(640,30,'ct/kWh','end');
    label(62,255,t('batteryBehaviour'));label(640,255,'kW','end');
    for(const v of [m.minimum,(m.minimum+m.maximum)/2,m.maximum]){
      marks.push(node('line',{x1:62,x2:640,y1:py(v),y2:py(v),stroke:'var(--border)'}));label(52,py(v)+7,format(v,0),'end');
    }
    for(const v of [-2500,0,2500]){
      marks.push(node('line',{x1:62,x2:640,y1:wy(v),y2:wy(v),stroke:'var(--border)'}));label(52,wy(v)+7,format(v/1000),'end');
    }
    for(const part of m.plan.intervals){
      const left=x(part.from),width=Math.max(.5,x(part.until)-left-.7),color=part.action==='charge'?'var(--blue)':part.action==='discharge'?'#e7a052':'#617064';
      marks.push(node('rect',{x:left,y:Math.min(py(part.price),py(0)),width,height:Math.max(1,Math.abs(py(part.price)-py(0))),fill:'var(--muted)',opacity:.65}));
      marks.push(node('rect',{x:left,y:Math.min(wy(part.powerW),wy(0)),width,height:Math.max(1,Math.abs(wy(part.powerW)-wy(0))),fill:color}));
      if(part.sun!==null)marks.push(node('rect',{x:left,y:261,width:part.sun>0?Math.max(.5,width*part.sun):width,height:3,fill:part.sun>0?'#FFD35A':'#617064'}));
    }
    // Predicted SoC uses its own 0–100% scale, independently of signed watts.
    const sy=percent=>407-percent/100*140;
    for(const percent of [0,50,100])label(646,sy(percent)+7,`${percent}%`,'start','#48BD70');
    const soc=batterySocView(history,battery.plan,from,m.until,battery.percentage,now);
    for(const [a,b] of soc.measured) marks.push(node('line',{x1:x(a.at),x2:x(b.at),y1:sy(a.soc),y2:sy(b.soc),stroke:'#48bd70','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
    marks.push(node('polyline',{points:soc.predicted.map(p=>`${x(p.at)},${sy(p.soc)}`).join(' '),fill:'none',stroke:'#48BD70','stroke-width':2,'stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke','aria-label':t('batteryExpectedSoc')}));
    for(const epoch of [from,(from+m.until)/2,m.until]){
      const anchor=epoch===from?'start':epoch===m.until?'end':'middle';
      for(const y of [220,440])label(x(epoch),y,clock(epoch),anchor);
    }
    for(const [epoch,color] of [[Math.max(m.from,now.getTime()/1000),'#617064'],[q.from,'var(--text)']]){
      for(const [a,b]of [[52,192],[267,407]])marks.push(node('line',{x1:x(epoch),x2:x(epoch),y1:a,y2:b,stroke:color,'stroke-width':2}));
    }
    // Historical SoC is measured; past power is still unavailable in this plot.
    if(typeof live==='number' && Number.isFinite(live)) marks.push(node('circle',{cx:x(now.getTime()/1000),cy:wy(Math.max(-2500,Math.min(2500,live))),r:5,fill:'var(--text)',stroke:'var(--panel)','stroke-width':2}));
    svg.replaceChildren(...marks);
  }
  slider.addEventListener('input',()=>{
    const m=batteryDetailModel(last?.plan);if(!m)return;
    selected=m.plan.intervals[Number(slider.value)]?.from??null;render(last);
  });
  svg.addEventListener('click',event=>{
    const m=batteryDetailModel(last?.plan);if(!m)return;
    const x=(event.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*720;
    selected=Math.min(m.until-1,Math.max(viewportFrom??m.from,(viewportFrom??m.from)+(x-62)/578*(m.until-(viewportFrom??m.from))));render(last);
  });
  return {render,reset(){selected=null;last=null;svg.replaceChildren();}};
}
