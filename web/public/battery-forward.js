import {forwardClock} from './battery-plan.js';

// The overview price chart owns the timeline; this card only summarises now/next.
// No client-side optimisation or device control is performed here.
export function renderForwardBattery(view, t, now) {
  const $=id=>document.getElementById(id), p=view.plan;
  const clock=epoch=>forwardClock(epoch,now,document.documentElement.lang || 'nl');
  const action=q=>t(`batteryAction${q.action}`);
  const state=p.mode==='shadow'?t('batteryShadow'):t('batteryActivePlan');
  const execution=p.execution;
  const actual=execution?{action:execution.targetW<0?'charge':execution.targetW>0?'discharge':'hold'}:view.current;
  $('battery-goal').textContent=execution?.mode==='paused'?t('batteryControlPaused'):`${state} · ${action(actual)}`;
  $('battery-goal').dataset.batteryAction=execution?.mode==='paused'?'':actual.action;
  $('battery-plan-status').textContent=view.next?
    t('batteryNextAction').replace('{action}',action(view.next)).replace('{time}',clock(view.next.from)):t('batteryNoNext');
  $('battery-plan-status').dataset.batteryAction=view.next?.action || '';
  $('battery-plan-rate').textContent=execution?
    `${t('batteryControl'+execution.reason)} · ${t('batteryRequested')} ${Math.round(execution.targetW)} W`:
    p.atRisk?t('batteryTargetRisk'):view.current.ev!==false?t('batteryEvProtected'):'';
}
