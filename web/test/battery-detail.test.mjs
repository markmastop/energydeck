import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {batteryDetailModel,batteryDetailTimeline,initializeBatteryDetail} from '../public/battery-detail.js';

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
  assert.deepEqual(m.socPoints,[{at:epoch,percentage:50},{at:epoch+60,percentage:50.3},{at:epoch+960,percentage:47.7}],
    'Predicted charge includes the initial level and quarter ends, preserving partial-quarter UTC timing');
  assert.equal(batteryDetailModel(plan,now,epoch-1).index,0,'Out-of-horizon selection follows now');
  assert.equal(batteryDetailModel(plan,new Date((epoch+601)*1000)),null);
});

test('home battery action and its back button use the existing dedicated-page navigation',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/details.js',import.meta.url),'utf8');
  assert.match(html,/class="battery-card-open"[^>]*data-open="battery"/);
  assert.match(html,/<section id="page-battery"[\s\S]*?data-open="overview"/);
  assert.match(js,/\['overview', 'energy', 'sonos', 'climate', 'battery'\]/);
  assert.match(js,/page === 'battery'\) batteryDetail.render\(dashboard.battery,new Date\(\),dashboard.prices\)/);
});


test('past prices and measured SoC share the full elapsed-time viewport without invented power',()=>{
  const start=Date.parse('2026-10-24T22:00:00Z')/1000;
  const history={start:start*1000,end:(start+90000)*1000,points:[{time:(epoch-600)*1000,value:51},{time:(epoch-300)*1000,value:50}]};
  const prices={today:{date:'2026-10-25',values:Array(100).fill(8)}};
  const m=batteryDetailModel(plan,now);
  const timeline=batteryDetailTimeline(m,history,prices,now,epoch-450);
  assert.equal(timeline.from,start);assert.equal(timeline.at,epoch-450);
  assert.equal(timeline.price,8);assert.equal(timeline.part,null);
  assert.equal(timeline.measured,50.5);
  assert.equal(batteryDetailTimeline(m,{...history,points:[history.points[0]]},prices,now,epoch-600).measured,51);
  assert.ok(timeline.bars.some(q=>q.from===start));
  assert.ok(timeline.bars.filter(q=>q.from<epoch).every(q=>q.powerW===undefined));
  assert.equal(timeline.minimum,-10);assert.equal(timeline.maximum,50);
  assert.ok(timeline.ticks.some(t=>t.text==='25/10'));
  assert.ok(timeline.ticks.some(t=>t.text==='06:00'));
  assert.equal(batteryDetailTimeline(m,history,{today:{date:'2026-10-25',values:Array(96).fill(8)}},now,epoch-450).price,null,'Wrong DST count does not fabricate history');
  assert.equal(batteryDetailTimeline(m,null,prices,now).from,start,'Published prices remain visible without SoC history');
  assert.equal(batteryDetailTimeline(m,history,prices,now,m.until+100).at,m.until-1);
});


test('detail renderer places the slider at now on the full chart and separates historical readouts',async()=>{
  const translations=JSON.parse(await readFile(new URL('../public/translations.json',import.meta.url),'utf8')).nl;
  const elements=new Map();
  const make=()=>({attrs:{},events:{},textContent:'',children:[],setAttribute(k,v){this.attrs[k]=v;},
    addEventListener(k,v){this.events[k]=v;},replaceChildren(...nodes){this.children=nodes;},
    getBoundingClientRect(){return {left:0,width:720};}});
  const previous=globalThis.document;
  globalThis.document={documentElement:{lang:'nl'},getElementById(id){if(!elements.has(id))elements.set(id,make());return elements.get(id);},createElementNS:make};
  try {
    const start=Date.parse('2026-10-24T22:00:00Z')/1000;
    const battery={percentage:50,power:632,plan,history:{start:start*1000,end:(start+90000)*1000,
      points:[{time:(epoch-600)*1000,value:51},{time:(epoch-300)*1000,value:50}]}};
    const view=initializeBatteryDetail({t:key=>translations[key],format:(v,n=1)=>v===null?'—':Number(v).toFixed(n)});
    view.render(battery,now,{today:{date:'2026-10-25',values:Array(100).fill(8)}});
    const slider=elements.get('battery-detail-selection'),svg=elements.get('battery-comparison');
    assert.ok(slider.value/slider.max>.9,'Now is at the end of a day of history, not at the left edge');
    const lines=svg.children.filter(n=>n.attrs.stroke==='var(--text)');
    assert.ok(Math.abs(lines[0].attrs.x1-(62+578*(epoch-start)/(epoch+960-start)))<.01);
    assert.match(elements.get('battery-detail-selected').textContent,/verwacht vermogen/);
    assert.match(elements.get('battery-detail-live').textContent,/Ontladen.*632 W.*50%/);
    const timeline=batteryDetailTimeline(batteryDetailModel(plan,now),battery.history,null,now,epoch-450);
    assert.equal(timeline.part,null);assert.equal(timeline.measured,50.5);
    view.reset();assert.deepEqual(svg.children,[]);
  } finally {globalThis.document=previous;}
});
