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
  if (poll.includes('lvgl.page.show') || poll.includes('open_music_page')) throw new Error('Polling must not navigate pages');
  if (poll.includes('close_music_page')) throw new Error('Polling must keep explicitly opened detail available');
  if (!poll.includes('follow_compact_tab(id(detail_tab))') || !poll.includes('script.execute: select_detail_tab'))
    throw new Error('Polling must follow playback in the compact card');
  const favorite = music.split('  - id: play_music_favorite\n')[1].split('  - id: music_favorite_timeout\n')[0];
  if (favorite.includes('prepare_favorite_setup') || favorite.includes('favorite_setup_confirmed') ||
      (favorite.match(/script.execute: refresh_music\n/g) || []).length !== 3 ||
      !favorite.includes('id(sonos).prepare_favorite(id(music_favorite_copy))'))
    throw new Error('Favorites must use the displayed scope without setup writes or a second preflight, with read-back after a failed write');
  const favoriteTimeout = music.split('  - id: music_favorite_timeout\n')[1];
  if (!favoriteTimeout.includes('script.execute: refresh_music') || !favoriteTimeout.includes('if (!id(music_favorite_pending)) return;'))
    throw new Error('Favorite timeout must re-read actual playback after UI-deferred publication');
  if (!music.includes('id(sonos).request_delay_ms()') || !music.includes('Command stopped: %s, HTTP %d, UPnP/readiness %d'))
    throw new Error('Favorites need cooperative readiness waits and actionable failure diagnostics');
  const select = music.split('  - id: select_music_system\n')[1].split('  - id: apply_music_group\n')[0];
  if (select.includes('script.wait:') || select.includes('id(music_busy) = true') || select.includes('script.execute: refresh_music_cover'))
    throw new Error('Room selection must not wait, lock the UI or connect artwork HTTP');
  if (!select.includes('id(sonos).select_system(uuid)') || !select.includes('id(music_room_refresh_pending) = true') ||
      select.indexOf('script.execute: render_music') > select.indexOf('script.execute: refresh_music'))
    throw new Error('Room selection must publish immediately before a coalesced background refresh');
  const refresh = music.split('  - id: refresh_music\n')[1].split('  - id: refresh_music_room_activity\n')[0];
  if (refresh.indexOf('script.execute: render_music') > refresh.indexOf('script.execute: refresh_music_room_activity') ||
      !refresh.includes('if (id(music_room_refresh_pending) && !id(music_busy)) return;'))
    throw new Error('Publish the player before activity reads and never finish an abandoned partial poll');
  const browse = music.split('  - id: sonos_favorite_requests\n')[1].split('  - id: refresh_music_favorites\n')[0];
  if (!browse.includes('!id(music_room_refresh_pending) && !id(music_selection_loading)') ||
      !browse.includes('submit(id(sonos_favorites).request(), 1500)'))
    throw new Error('Favorites Browse must yield to room refreshes with a bounded read deadline');
  const artwork = music.split('  - id: refresh_music_cover\n')[1].split('  - id: refresh_music_cover_after_scroll\n')[0];
  if (!artwork.includes('if (id(music_page_open) && id(music_content_tab) == 1) return;'))
    throw new Error('Room browsing must not start foreground artwork connections');
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
  const detail = dashboard.split('id: small_music_detail_target\n')[1]?.split('              - button:')[0];
  if (!detail?.includes('script.execute: open_music_page') || !detail.includes('clickable: true') ||
      dashboard.includes('music_page_button'))
    throw new Error('The cover/title must open detail without a separate Detail button');
  const close = music.split('  - id: close_music_page\n')[1].split('  - id: render_sonos_energy_header')[0];
  if (!close.includes('id(detail_tab) = 1')) throw new Error('Back must return to the compact Sonos card');
  const header = music.split('  - id: render_sonos_energy_header\n')[1].split('  # Read-only polls')[0];
  if (header.includes('lv_obj_set_x(id(solar_') || !dashboard.includes('id: sonos_battery_gauge\n                  hidden: true\n                  x: 314') || !header.includes('id(electricity_today_unit_label)') ||
      !header.includes('lv_bar_get_value(id(battery_level_bar))') ||
      !header.includes('lv_obj_get_style_bg_color(id(battery_level_bar), LV_PART_INDICATOR)') ||
      !header.includes('lv_obj_get_style_text_color(id(battery_status_label), LV_PART_MAIN)'))
    throw new Error('Sonos header must keep solar right, battery middle and reuse battery values/colors');
  const tab = dashboard.split('id: music_tab\n')[1].split('        - button:')[0];
  if (!tab.includes('script.execute: open_music_page'))
    throw new Error('Right Sonos button must open detail directly in every playback state');
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
