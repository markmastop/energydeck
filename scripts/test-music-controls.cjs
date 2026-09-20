// Compile the production Sonos model without issuing any network writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-sonos-'));
try {
  const binary = path.join(temp, 'test');
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror',
    path.join(__dirname, 'test-sonos-local.cpp'), '-o', binary], {stdio: 'inherit'});
  execFileSync(binary, [], {stdio: 'inherit'});
  const music = fs.readFileSync(path.join(__dirname, '../esphome/packages/music.yaml'), 'utf8');
  const image = music.split('\nimage:')[1].split('\nscript:')[0];
  if (/Authorization:/.test(image)) throw new Error('Homey credentials must never be sent to Sonos artwork');
  if (music.includes('advancedflow/') || music.includes('Authorization:')) throw new Error('The Sonos page must not depend on Homey');
  const poll = music.split('  - id: refresh_music\n')[1].split('  - id: switch_music_room')[0];
  if (poll.includes('lvgl.page.show') || poll.includes('select_detail_tab')) throw new Error('Polling must not navigate');
  for (const page of ['sonos_page', 'energydeck_main_page']) {
    if (!music.includes(`lv_obj_set_parent(id(shared_energy_header), id(${page})->obj)`))
      throw new Error('Both pages must share the live energy header');
  }
  const page = fs.readFileSync(path.join(__dirname, '../esphome/packages/sonos-page.yaml'), 'utf8');
  if (!/id: music_back\s+x: 14\s+y: 154/.test(page))
    throw new Error('Sonos must start at the top of the energy tabs');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
