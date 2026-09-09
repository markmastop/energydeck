const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const yaml = fs.readFileSync(path.join(__dirname, '../esphome/packages/homey-live.yaml'), 'utf8');
const start = yaml.indexOf('auto price_source_for =');
const end = yaml.indexOf('const int today_source', start);
if (start < 0 || end < 0) throw Error('Source parser missing');
const cases = [
  [{today:{date:'2026-09-09',source:'homey'},tomorrow:{source:'epexprijzen'}},1,2],
  [{today:{date:'2026-09-09'},tomorrow:{date:'2026-09-10'},sources:{'2026-09-09':'EpexPrijzen.nl (raw EUR/kWh)','2026-09-10':'Homey'}},2,1],
  [{today:{date:'2026-09-09'},tomorrow:{date:'2026-09-10',source:'homey'}},0,1],
  [{today:{source:'unavailable'},tomorrow:{source:'other'}},0,0],
  [{today:{date:'2026-09-09'},sources:{'2026-09-08':'Homey'},warnings:['EpexPrijzen']},0,0],
];
const checks = cases.map(([data,a,b]) => `check(${JSON.stringify(JSON.stringify(data))},${a},${b});`).join('\n');
const cpp = '#include <cstring>\n#include <cstdio>\n#include <cassert>\nvoid check(const char *encoded,int a,int b){\n' + yaml.slice(start,end) + '\nassert(price_source_for("\\"today\\"")==a); assert(price_source_for("\\"tomorrow\\"")==b); }\nint main(){'+checks+'}';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'price-source-'));
try {
 fs.writeFileSync(path.join(dir,'test.cpp'),cpp);
 execFileSync('c++',['-std=c++17',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')]);
 execFileSync(path.join(dir,'test'));
 console.log('PASS: per-day and legacy sources, independent days, unknown and missing metadata');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
