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
  if (page.includes('music_favorites_refresh') || page.includes('${music_favorites}'))
    throw new Error('Favorites should not have a heading or manual refresh button');
  if (!music.includes('interval: 5min') || !music.split('  - id: open_music_page')[1].split('  - id: close_music_page')[0].includes('script.execute: refresh_music_favorites'))
    throw new Error('Favorites must still refresh automatically and on opening');
  const back = page.split('id: music_back\n')[1].split(/\n  - label:/)[0];
  if (!back.includes('x: 14') || !back.includes('y: 154'))
    throw new Error('Sonos must start at the top of the energy tabs');
  if (back.includes('\\uf060') || !back.includes('- line:') || !back.includes('clickable: false'))
    throw new Error('The back arrow must be drawn without a missing font glyph');
  const cover = page.split('id: music_cover_frame\n')[1].split('  - label:')[0];
  if (!cover.includes('width: 272') || !cover.includes('height: 272'))
    throw new Error('The detail cover must have the larger square footprint');
  for (const id of ['music_previous', 'music_play', 'music_next', 'music_minus', 'music_plus', 'music_mute']) {
    const widget = page.split(`id: ${id}\n`)[1].split('  - ')[0];
    const x = Number(widget.match(/\bx: (\d+)/)[1]);
    if (x < 310) throw new Error(`${id} must sit to the right of the cover`);
  }
  const dashboard = fs.readFileSync(path.join(__dirname, '../esphome/packages/dashboard.yaml'), 'utf8');
  const tab = dashboard.split('id: music_tab\n')[1].split('        - button:')[0];
  if (!tab.includes('id(detail_tab) = 1') || !tab.includes('script.execute: select_detail_tab') || tab.includes('open_music_page'))
    throw new Error('Right Sonos tab must select the compact card, not navigate');
  const openPage = dashboard.split('id: music_page_button\n')[1].split('              - obj:')[0];
  if (!openPage.includes('${music_open_page}') || !openPage.includes('script.execute: open_music_page') || openPage.includes('start_radio'))
    throw new Error('Compact Page button must only open the full player');
  if (!music.includes('{id(gas_card), id(music_card), id(extra_card)}') || music.includes('if (id(detail_tab) == 1) id(detail_tab) = 0'))
    throw new Error('Returning from the full page must preserve the compact Sonos tab');
  for (const widget of ['title', 'artist', 'volume', 'status', 'play', 'minus', 'plus', 'room_select']) {
    if (!music.includes(`{id(small_music_${widget}), id(music_${widget})}`))
      throw new Error(`Compact ${widget} must share the full player state`);
  }
  if (!music.includes('if (!id(music_page_open) && id(detail_tab) != 1) return;'))
    throw new Error('Artwork must refresh for both Sonos views');
  if (!/id: shared_energy_header[\s\S]*?text_color: 0xEEF6F0/.test(dashboard))
    throw new Error('The shared energy header needs an explicit readable text color');
  if (!/id: homey_status_label\s+x: 284\s+y: 14\s+width: 182/.test(dashboard))
    throw new Error('Homey status must stay inside the right edge');
  if (!page.includes('id: music_cover_frame') || !dashboard.includes('lv_obj_set_style_clip_corner(id(music_cover_frame), true, 0)'))
    throw new Error('Artwork must clip to the rounded cover frame');
  if (!music.includes('LV_SYMBOL_PAUSE : LV_SYMBOL_PLAY') || !music.includes('glyph.is_placeholder'))
    throw new Error('Use transport icons and filter unsupported favorite glyphs');
  for (const language of ['nl', 'en']) {
    const translations = fs.readFileSync(path.join(__dirname, `../esphome/translations/${language}.yaml`), 'utf8');
    for (const key of ['energy_ytd', 'power_peak', 'solar_today']) {
      const line = translations.split('\n').find(l => l.startsWith(`${key}:`));
      if (!line?.startsWith(`${key}: "`) || !line.includes('\\n'))
        throw new Error(`${language}/${key} must decode a real newline for LVGL initial text`);
    }
  }
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
