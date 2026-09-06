// Exercise the production window-selection, parser and in-place shift with synthetic days.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../esphome/packages/homey-live.yaml'), 'utf8');
let fragment = source.slice(source.indexOf('const bool rolling ='), source.indexOf('lv_label_set_text(id(price_chart_title_label)'));
fragment = fragment.replaceAll('id(show_tomorrow_prices)', 'selectedTomorrow')
  .replace(/\$\{energy_tax_ex_vat_ct\}/g, '0.0').replace(/\$\{vat_percent\}/g, '0.0')
  .replace(/\$\{supplier_fee_incl_vat_ct\}/g, '0.0');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-window-'));
try {
  fs.writeFileSync(path.join(dir, 'test.cpp'), `
#include <algorithm>
#include <cassert>
#include <cstring>
#include <cstdlib>
#include <string>
#define ESP_LOGW(...) ((void)0)
bool test(int hour, bool tomorrow_available, bool selectedTomorrow) {
  struct { int hour; } price_now{hour};
  std::string data = "{\\\"today\\\":{\\\"values\\\":[";
  for(int i=0;i<96;i++) data += (i ? "," : "") + std::to_string(i);
  data += "]},\\\"tomorrow\\\":{\\\"values\\\":[";
  for(int i=96;i<192;i++) data += (i==96 ? "" : ",") + std::to_string(i);
  data += "]}}";
  const char *encoded=data.c_str();
  const char *prices_start=strstr(strstr(encoded, selectedTomorrow ? "\\\"tomorrow\\\"" : "\\\"today\\\""), "\\\"values\\\":[");
  ${fragment}
  int expected = selectedTomorrow ? 96 : (tomorrow_available && hour>=12 ? 48 : 0);
  for(int i=0;i<96;i++) assert(prices[i] == expected+i);
  assert(minimum==expected && maximum==expected+95);
  if(!selectedTomorrow) {
    int visible_current=hour*4-window_offset;
    assert(visible_current>=0 && visible_current<96);
    assert(prices[visible_current]==hour*4);
  }
  return true;
}
int main(){for(int h: {0,11,12,17,23}) for(bool available: {false,true}) for(bool selected: {false,true}) assert(test(h,available,selected));}
`);
  cp.execFileSync('c++', ['-std=c++17', path.join(dir, 'test.cpp'), '-o', path.join(dir, 'test')]);
  cp.execFileSync(path.join(dir, 'test'));
  console.log('Price window tests passed (20 combinations).');
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
