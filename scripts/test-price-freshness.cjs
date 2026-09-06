// Compile the actual firmware validation fragment against synthetic bridge data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = fs.readFileSync(path.join(__dirname, '../esphome/packages/homey-live.yaml'), 'utf8');
const start = yaml.indexOf('char today_key[32];');
const end = yaml.indexOf('lv_label_set_text(id(tomorrow_average_label), "");', start);
if (start < 0 || end < 0) throw new Error('Firmware validation fragment not found');
const validation = yaml.slice(start, end);
const payload = (date, values) => JSON.stringify({today: {date, values}});
const cases = [
  [payload('2026-09-06', Array(96).fill(0.12)), true],
  [payload('2026-09-05', Array(96).fill(0.12)), false],
  [payload('2026-09-07', Array(96).fill(0.12)), false],
  [payload('2026-09-06', []), false],
  [payload('2026-09-06', Array(95).fill(0.12)), false],
  [payload('2026-09-06', Array(97).fill(0.12)), false],
  [payload('2026-09-06', Array(96).fill(null)), false],
  [payload('2026-09-06', Array(96).fill(-0.12)), true],
  [JSON.stringify({today: {}, tomorrow: {date:'2026-09-06', values:Array(96).fill(0.12)}}), false],
];
const checks = cases.map(([value, expected]) =>
  'assert(valid(' + JSON.stringify(value) + ') == ' + expected + ');').join('\n');
const source = '#include <cmath>\n#include <cstring>\n#include <cstdio>\n#include <cstdlib>\n#include <cassert>\n' +
  'bool valid(const char *encoded) { struct {int year=2026, month=9, day_of_month=6;} price_now;\n' +
  validation + '\nreturn true; }\nint main(){\n' + checks + '\n}\n';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-freshness-'));
try {
  fs.writeFileSync(path.join(temp, 'test.cpp'), source);
  execFileSync('c++', ['-std=c++17', path.join(temp, 'test.cpp'), '-o', path.join(temp, 'test')]);
  execFileSync(path.join(temp, 'test'));
  console.log('PASS: current, stale, future, missing, incomplete, oversized, null and negative prices');
} finally {
  fs.rmSync(temp, {recursive:true, force:true});
}
