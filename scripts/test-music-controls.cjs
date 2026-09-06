// Test actual firmware calculation/recovery fragments without contacting Homey.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const yaml = fs.readFileSync(path.join(__dirname, '../esphome/packages/music.yaml'), 'utf8');
function fragment(start, end) {
  const a = yaml.indexOf(start), b = yaml.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('Firmware fragment missing');
  return yaml.slice(a, b).replace(/id\((\w+)\)/g, '$1');
}
const calculate = fragment('id(music_action) = action;', '                  - http_request.send:');
const recover = fragment('// Only fresh observations', '      - script.execute: render_music');
const source = `
#include <algorithm>
#include <cassert>
bool sonos_living_known, sonos_kitchen_known, sonos_living_playing, sonos_kitchen_playing;
bool music_target_playing, radio_pending, radio_failed;
int music_action, music_target_living, music_target_kitchen, sonos_living_volume, sonos_kitchen_volume;
struct { void stop() {} } radio_timeout;
void calculate(int action) { ${calculate} }
void recover() { ${recover} }
int main() {
  for (int v=0; v<=100; ++v) {
    sonos_living_volume=v; sonos_kitchen_volume=100-v;
    calculate(1);
    assert(music_target_living==std::max(0,v-2));
    assert(music_target_kitchen==std::max(0,98-v));
    calculate(2);
    assert(music_target_living==std::min(100,v+2));
    assert(music_target_kitchen==std::min(100,102-v));
  }
  for (int a=0;a<2;++a) for(int b=0;b<2;++b) {
    sonos_living_playing=a; sonos_kitchen_playing=b; calculate(0);
    assert(music_target_playing==!(a||b));
  }
  sonos_living_known=sonos_kitchen_known=true;
  sonos_living_playing=sonos_kitchen_playing=true;
  radio_failed=true; radio_pending=false; recover();
  assert(!radio_failed); // Regression: recover even after the start timed out.
  radio_pending=true; radio_failed=true; sonos_kitchen_known=false; recover();
  assert(radio_pending && radio_failed); // Missing data is not confirmation.
}
`;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-music-'));
try {
  fs.writeFileSync(path.join(temp,'test.cpp'),source);
  execFileSync('c++',['-std=c++17',path.join(temp,'test.cpp'),'-o',path.join(temp,'test')]);
  execFileSync(path.join(temp,'test'));
  console.log('PASS: volume steps/bounds, playback toggle, late start recovery and missing data');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
