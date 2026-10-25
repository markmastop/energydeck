import {forwardClock} from './battery-plan.js';

// The overview price chart owns the timeline; this card only summarises now/next.
// No client-side optimisation or device control is performed here.
export function renderForwardBattery(view, t, now) {
  const $=id=>document.getElementById(id), p=view.plan;
  const clock=epoch=>forwardClock(epoch,now,document.documentElement.lang || 'nl');
  const action=q=>t(`batteryAction${q.action}`);
  const state=p.mode==='shadow'?t('batteryShadow'):t('batteryActivePlan');
  $('battery-goal').textContent=`${state} · ${action(view.current)}`;
  $('battery-plan-status').textContent=view.next?
    t('batteryNextAction').replace('{action}',action(view.next)).replace('{time}',clock(view.next.from)):t('batteryNoNext');
  $('battery-plan-rate').textContent=p.atRisk?t('batteryTargetRisk'):view.current.ev!==false?t('batteryEvProtected'):'';
}
