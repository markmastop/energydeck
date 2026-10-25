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
}
