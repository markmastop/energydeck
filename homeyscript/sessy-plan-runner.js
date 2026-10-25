/*
 * Installed as "Sessy - Laadplan". Manual Run defaults to a read-only preview.
 * Only the existing normal-control Flow passes the explicit "control" argument.
 * The installer embeds the same controller/planner source used by offline tests.
 */
const mode = typeof args === 'undefined' || args.length === 0 ? 'preview' : args[0];
if (!['preview', 'preview-active', 'control'].includes(mode) || (typeof args !== 'undefined' && args.length > 1)) {
  throw new Error('Use no argument (preview), "preview", or "control".');
}
const applyWrites = mode === 'control';
const pending = [];
let names = {};
let previousSnapshot = null;
// The preview facade has no device-command or Flow API. It intercepts every
// controller Logic write rather than depending on individual write-site guards.
const controllerHomey = {
  logic: {
    async getVariables() {
      const found = await Homey.logic.getVariables();
      names = Object.fromEntries(Object.values(found).map(v => [v.id, v.name]));
      previousSnapshot = Object.values(found).find(v => v.name === 'sessy_ready_by_17_plan')?.value;
      // Installer-only dry run: exercise activation while the real flag stays off.
      return mode === 'preview-active' ? Object.fromEntries(Object.entries(found).map(([id,v]) =>
        [id, v.name === 'sessy_price_plan_enabled' ? {...v,value:true} : v])) : found;
    },
    async updateVariable(change) {
      const name = names[change.id];
      if (!['sessy_ready_by_17_state', 'sessy_doel_vermogen', 'sessy_ready_by_17_plan', 'sessy_price_profile'].includes(name)) {
        throw new Error('Unexpected controller output');
      }
      pending.push({name, value: change.variable.value});
      if (applyWrites) return Homey.logic.updateVariable(change);
    },
  },
  devices: {getDevice: query => Homey.devices.getDevice(query)},
  insights: {getLogEntries: query => Homey.insights.getLogEntries(query)},
};
const result = await (async function(Homey) {
/* __SESSY_CONTROLLER_SOURCE__ */
})(controllerHomey);
if (applyWrites) return result;

// Summarise contiguous actions for the script editor; the published reader
// snapshot remains untouched during a manual test, including its freshness.
const snapshot = pending.find(p => p.name === 'sessy_ready_by_17_plan');
const plan = JSON.parse(snapshot?.value || previousSnapshot || '{}').forwardPlan;
const phases = [];
const stamp = epoch => new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(epoch * 1000));
for (const q of plan?.intervals || []) {
  let phase = phases.at(-1);
  if (!phase || phase.action !== q.action || phase.ev !== q.ev || phase.until !== q.from) {
    phase = {action: q.action, ev: q.ev, from: q.from, until: q.until,
      priceMin: q.price, priceMax: q.price, powerMinW: q.powerW, powerMaxW: q.powerW,
      socFrom: q.socFrom, socTo: q.socTo, sunMinutes: 0, sunshineKnownQuarters: 0};
    phases.push(phase);
  }
  phase.until = q.until; phase.socTo = q.socTo;
  phase.priceMin = Math.min(phase.priceMin, q.price); phase.priceMax = Math.max(phase.priceMax, q.price);
  phase.powerMinW = Math.min(phase.powerMinW, q.powerW); phase.powerMaxW = Math.max(phase.powerMaxW, q.powerW);
  if (Number.isFinite(q.sun)) { phase.sunMinutes += q.sun * (q.until - q.from) / 60; phase.sunshineKnownQuarters++; }
}
return {preview: true, writesApplied: 0, controller: result,
  proposal: plan ? {mode: plan.mode, inputQuality: plan.inputQuality, atRisk: plan.atRisk,
    quarters: plan.intervals.length, phases: phases.map(p => ({...p, start: stamp(p.from), end: stamp(p.until)}))} : null,
  proposedWrites: pending.map(p => p.name)};
