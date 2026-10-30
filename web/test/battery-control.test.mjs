import test from 'node:test';
import assert from 'node:assert/strict';
import {renderForwardBattery} from '../public/battery-forward.js';
import fs from 'node:fs';
const translations=JSON.parse(fs.readFileSync(new URL('../public/translations.json',import.meta.url))).nl;
test('overview distinguishes requested action, planned next phase and L3 limitation',()=>{
  const nodes=Object.fromEntries(['battery-goal','battery-plan-status','battery-plan-rate'].map(id=>[id,{textContent:'',dataset:{}}]));
  globalThis.document={getElementById:id=>nodes[id],documentElement:{lang:'nl'}};
  const view={plan:{mode:'active',atRisk:false,execution:{mode:'active',reason:'phase-limit',targetW:-250}},
    current:{action:'charge',ev:true},next:{action:'discharge',from:1793001600}};
  renderForwardBattery(view,key=>translations[key],new Date('2026-10-25T19:00:00Z'));
  assert.match(nodes['battery-goal'].textContent,/actief.*Bijladen/);
  assert.match(nodes['battery-plan-status'].textContent,/Ontladen/);
  assert.match(nodes['battery-plan-rate'].textContent,/L3.*-250 W/);
  assert.equal(nodes['battery-goal'].dataset.batteryAction,'charge');
  assert.equal(nodes['battery-plan-status'].dataset.batteryAction,'discharge');
  view.plan.execution={mode:'paused',reason:'ev-unknown',targetW:0};
  renderForwardBattery(view,key=>translations[key],new Date('2026-10-25T19:00:00Z'));
  assert.match(nodes['battery-goal'].textContent,/gepauzeerd/);
  assert.match(nodes['battery-plan-rate'].textContent,/Autostatus onbekend.*0 W/);
  assert.equal(nodes['battery-goal'].dataset.batteryAction,'');
  delete globalThis.document;
});
