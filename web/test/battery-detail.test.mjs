import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {batteryDetailModel} from '../public/battery-detail.js';

const now=new Date('2026-10-25T22:59:00Z'),epoch=now.getTime()/1000;
const plan={version:2,mode:'shadow',inputQuality:'provisional',updatedAt:epoch,validUntil:epoch+600,
  capacityKwh:5,topUpW:1000,reservePercent:10,endReservePercent:20,atRisk:false,
  intervals:[{from:epoch,until:epoch+60,action:'charge',powerW:-1000,price:-10,socFrom:50,socTo:50.3,ev:true,sun:0},
    {from:epoch+60,until:epoch+960,action:'discharge',powerW:500,price:50,socFrom:50.3,socTo:47.7,ev:false,sun:.5}]};

test('detail plots retain one UTC axis and selected prices, signed power and expected SoC',()=>{
  const m=batteryDetailModel(plan,now,epoch+70);
  assert.equal(m.from,epoch);assert.equal(m.until,epoch+960);assert.equal(m.index,1);
  assert.equal(m.selected.price,50);assert.equal(m.selected.powerW,500);
  assert.equal(m.minimum,-10);assert.equal(m.maximum,50);
  assert.equal(m.powerMaximum,2500);assert.equal(m.sunshine[1].fraction,.5);
  assert.equal(batteryDetailModel(plan,now,epoch-1).index,0,'Out-of-horizon selection follows now');
  assert.equal(batteryDetailModel(plan,new Date((epoch+601)*1000)),null);
});

test('home battery action and its back button use the existing dedicated-page navigation',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/details.js',import.meta.url),'utf8');
  assert.match(html,/class="battery-card-open"[^>]*data-open="battery"/);
  assert.match(html,/<section id="page-battery"[\s\S]*?data-open="overview"/);
  assert.match(js,/\['overview', 'energy', 'sonos', 'climate', 'battery'\]/);
  assert.match(js,/page === 'battery'\) batteryDetail.render\(dashboard.battery\)/);
});
