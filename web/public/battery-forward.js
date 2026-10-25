import {forwardClock} from './battery-plan.js';

// Compact overview and expandable detail consume exactly the same snapshot.
// No client-side optimisation or device control is performed here.
export function renderForwardBattery(view, t, format, now) {
  const $=id=>document.getElementById(id), p=view.plan;
  const clock=epoch=>forwardClock(epoch,now,document.documentElement.lang || 'nl');
  const action=q=>t(`batteryAction${q.action}`);
  const state=p.mode==='shadow'?t('batteryShadow'):t('batteryActivePlan');
  $('battery-goal').textContent=p.atRisk?t('batteryTargetRisk'):view.next?`${action(view.next)} · ${clock(view.next.from)}`:t('batteryNoNext');
  $('battery-plan-status').textContent=`${state} · ${action(view.current)}`;
  $('battery-plan-rate').textContent=view.current.ev!==false?t('batteryEvProtected'):`${t('batteryPlanRate')} ${format(p.topUpW/1000)} kW`;
  $('battery-timeline').hidden=false;
  $('battery-solar-window').hidden=$('battery-topup-window').hidden=true;
  $('battery-now-marker').style.left=`${view.now}%`;
  const phases=$('battery-phase-windows'); phases.hidden=false;
  phases.replaceChildren(...view.phases.map(q=>{
    const s=document.createElement('span'); s.className=`battery-phase ${q.action}`;
    s.style.left=`${q.left}%`;s.style.width=`${q.width}%`;
    s.title=`${clock(q.from)} · ${action(q)} · ${format(q.price)} ct/kWh`;return s;
  }));
  $('battery-reserve-time').textContent=clock(view.from);
  $('battery-start-time').textContent=t('batteryForward');
  $('battery-deadline-time').textContent=clock(view.until);
  $('battery-timeline').setAttribute('aria-label',`${state}. ${t('batteryForwardLegend')}. ${clock(view.from)} – ${clock(view.until)}`);
  const details=$('battery-forward-detail'); details.hidden=false;
  details.querySelector('summary').textContent=t('batteryPlanDetail');
  $('battery-plan-note').textContent=`${state} · ${p.inputQuality==='provisional'?t('batteryAssumptions'):t('batteryCalibrated')}. ${t('batteryForecastNote')}`;
  $('battery-plan-legend').textContent=t('batteryForwardLegend');
  const rows=[];
  for(const q of p.intervals) {
    const last=rows.at(-1);
    if(last && last.action===q.action && last.ev===q.ev){last.until=q.until;last.socTo=q.socTo;}
    else rows.push({...q});
  }
  $('battery-plan-phases').replaceChildren(...rows.map(q=>{
    const row=document.createElement('div');row.className=`battery-phase-row ${q.action}`;
    for(const value of [`${clock(q.from)} – ${clock(q.until)}`,`${action(q)}${q.ev!==false?` · ${t('batteryEvProtected')}`:''}`,`${format(q.socTo,0)}%`]){
      const cell=document.createElement('span');cell.textContent=value;row.append(cell);
    }return row;
  }));
  // Price bars and predicted SoC share a UTC axis, including both autumn hours.
  const svg=$('battery-plan-chart'), ns='http://www.w3.org/2000/svg';
  const node=(tag,attrs)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const qs=p.intervals, x=n=>30+(n-view.from)/(view.until-view.from)*520;
  const low=Math.min(0,...qs.map(q=>q.price)), high=Math.max(1,...qs.map(q=>q.price));
  const y=n=>100-(n-low)/(high-low)*80;
  const marks=[];
  for(const q of qs){
    const bar=node('rect',{x:x(q.from),y:Math.min(y(q.price),y(0)),width:Math.max(.5,x(q.until)-x(q.from)-.7),height:Math.max(1,Math.abs(y(q.price)-y(0))),fill:'var(--muted)',opacity:'.4'});
    const title=node('title',{});title.textContent=`${clock(q.from)}: ${format(q.price)} ct/kWh · ${format(q.socTo,0)}%`;bar.append(title);marks.push(bar);
    marks.push(node('rect',{x:x(q.from),y:106,width:Math.max(.5,x(q.until)-x(q.from)),height:6,class:`battery-phase ${q.action}`}));
    if(q.sun!==null)marks.push(node('rect',{x:x(q.from),y:118,width:Math.max(.5,(x(q.until)-x(q.from))*q.sun),height:3,fill:'#FFD35A'}));
  }
  marks.push(node('path',{d:`M${x(qs[0].from)},${100-qs[0].socFrom*.8} `+qs.map(q=>`L${x(q.until)},${100-q.socTo*.8}`).join(' '),fill:'none',stroke:'var(--green)','stroke-width':2}));
  for(const [xx,yy,label,anchor] of [[30,14,'ct/kWh','start'],[550,14,'0–100%','end'],[30,138,clock(view.from),'start'],[550,138,clock(view.until),'end']]){
    const n=node('text',{x:xx,y:yy,'text-anchor':anchor,fill:'var(--muted)','font-size':20});n.textContent=label;marks.push(n);
  }
  svg.replaceChildren(...marks);svg.setAttribute('aria-label',t('batteryForecastChart'));
}
