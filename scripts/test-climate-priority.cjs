const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const read = name => fs.readFileSync(path.join(__dirname, '../esphome/packages', name), 'utf8');
const climate = read('climate.yaml'), music = read('music.yaml'), dashboard = read('dashboard.yaml');
const tab = dashboard.split('id: extra_tab\n')[1].split('\n        - obj:')[0];
assert(tab.includes('script.execute: open_climate_page'));
const details = read('energy-details.yaml');
const open = details.split('id: open_climate_page\n')[1].split('  - id: close_detail_page')[0];
assert(open.includes('script.execute: refresh_climate'));
assert(open.indexOf('lvgl.page.show: climate_page') < open.indexOf('script.execute: refresh_climate'));
assert(!open.includes('script.execute: refresh_thermostats'));
// Reuse live weather widgets on both pages; navigation must not trigger weather HTTP.
const close = details.split('id: close_detail_page\n')[1].split('  - id: render_energy_header')[0];
for (const id of ['shared_weather_card', 'shared_weather_attribution']) {
  assert.equal((dashboard.match(new RegExp('id: ' + id + '\\n', 'g')) || []).length, 1);
  assert(open.includes(`lv_obj_set_parent(id(${id}), id(climate_page)->obj)`));
  assert(close.includes(`lv_obj_set_parent(id(${id}), id(energydeck_main_page)->obj)`));
}
assert(!open.includes('refresh_rain') && !open.includes('refresh_homey_weather'));
const roomLayout = read('climate-page.yaml');
for (let i = 1; i <= 9; ++i) {
  const card = roomLayout.split(`id: room_${i}_card\n`)[1].split('  - label:')[0];
  const y = Number(card.match(/y: (\d+)/)[1]), height = Number(card.match(/height: (\d+)/)[1]);
  assert(y + height <= 700, `Room ${i} overlaps the climate note/weather footer`);
}

assert.equal((details.match(/- background_http.get:/g) || []).length, 0);
assert(!details.includes('background_http.post:'));
assert(climate.includes('mode: single'));
assert(climate.includes('interval: 30s') && climate.includes('startup_delay: 20s'));
assert.equal((climate.match(/- background_http.get:/g) || []).length, 10);
assert.equal((climate.match(/- delay: 80ms/g) || []).length, 9);
assert(!climate.includes('delay: 500ms'));
assert(climate.includes('homey:app:com.honeywell:thermostat') && climate.includes('homey:app:com.honeywell:zone'));
assert(!climate.includes('/api/manager/logic/') && !climate.includes('homey_climate_sensor_'));
assert.equal((dashboard.match(/id: climate_sensor_[1-9]_slot/g) || []).length, 9);
assert.equal((read('climate-page.yaml').match(/id: room_[1-9]_card/g) || []).length, 9);
assert.equal((music.match(/id\(refresh_climate\)\.is_running\(\)/g) || []).length, 2);
assert(read('homey-live.yaml').includes('timeout: 8s'));
console.log('PASS: Evohome-only controller/nine-zone reads, immediate single-flight polling, all nine rooms on both views, artwork priority and unchanged HTTP timeout');
