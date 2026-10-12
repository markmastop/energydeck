// The runner inserts the actual production room-render lambda at the marker.
#include "lvgl.h"
#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <cstring>
#include <cstdlib>
#include <iostream>
#define id(value) (value)

// The simulator config delegates LVGL allocation to ESPHome. Use the same
// standard heap contract without linking the complete ESPHome application.
extern "C" {
void lv_mem_init() {}
void lv_mem_deinit() {}
void *lv_malloc_core(size_t size) { return std::malloc(size); }
void *lv_realloc_core(void *pointer, size_t size) { return std::realloc(pointer, size); }
void lv_free_core(void *pointer) { std::free(pointer); }
void lv_mem_monitor_core(lv_mem_monitor_t *monitor) { std::memset(monitor, 0, sizeof(*monitor)); }
lv_result_t lv_mem_test_core() { return LV_RESULT_OK; }
}

namespace esphome::ui_performance {
inline void set_text(lv_obj_t *label, const char *text) {
  if (std::strcmp(lv_label_get_text(label), text)) lv_label_set_text(label, text);
}
}
struct ScriptProbe {
  std::string uuid;
  int calls{0};
  void execute() { ++calls; }
  void execute(const std::string &value) { uuid = value; }
};
static energydeck_sonos::State sonos;
static energydeck_sonos::RoomActivity sonos_room_activity;
static bool music_page_open = true, music_busy = false, music_favorite_pending = false;
static int music_content_tab = 1;
static lv_obj_t *music_systems_list, *music_group_apply, *music_group_reset;
static ScriptProbe select_music_system, render_music, render_music_after_scroll;

static void render_rooms() {
// PRODUCTION_ROOM_RENDER
}

static std::string row_uuid(size_t row) {
  return lv_label_get_text(lv_obj_get_child(lv_obj_get_child(music_systems_list, row * 2), 3));
}
static void update_activity() {
  sonos_room_activity.begin(sonos);
  while (sonos_room_activity.has_request()) sonos_room_activity.accept(200,
    "<GetTransportInfoResponse><CurrentTransportState>STOPPED</CurrentTransportState></GetTransportInfoResponse>");
  sonos_room_activity.finish();
}
int main() {
  lv_init();
  auto *display = lv_display_create(480, 800);
  static uint16_t pixels[480 * 40];
  lv_display_set_buffers(display, pixels, nullptr, sizeof(pixels), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display, [](lv_display_t *d, const lv_area_t *, uint8_t *) { lv_display_flush_ready(d); });
  music_systems_list = lv_obj_create(lv_screen_active());
  lv_obj_remove_style_all(music_systems_list);
  lv_obj_set_size(music_systems_list, 452, 180);
  music_group_apply = lv_button_create(lv_screen_active());
  music_group_reset = lv_button_create(lv_screen_active());
  lv_label_create(music_group_apply); lv_label_create(music_group_reset);
  sonos.systems_known = sonos.systems_complete = true;
  for (const auto &name : {"Woonkamer", "Aanbouw", "Bureau", "Keuken", "Slaapkamer", "Zolder"})
    sonos.systems.push_back({name, name, name, "http://192.168.0.190:1400", "http://192.168.0.190:1400", name});
  sonos.rooms[0].uuid = sonos.rooms[0].coordinator = sonos.rooms[0].members = "Woonkamer";
  sonos.rooms[0].topology = sonos.rooms[0].transport = sonos.rooms[0].playing = true;
  sonos.rooms[1].uuid = sonos.rooms[1].coordinator = sonos.rooms[1].members = "Keuken";
  sonos.rooms[1].topology = sonos.rooms[1].transport = true;
  update_activity(); render_rooms();
  assert(row_uuid(0) == "Woonkamer" && row_uuid(1) == "Aanbouw");
  lv_obj_update_layout(music_systems_list);
  lv_obj_scroll_to_y(music_systems_list, 100, LV_ANIM_OFF);
  auto *first = lv_obj_get_child(music_systems_list, 0);
  const int scroll = lv_obj_get_scroll_y(music_systems_list);
  assert(scroll == 100);
  lv_obj_scroll_to_y(music_systems_list, 120, LV_ANIM_ON);
  assert(lv_obj_is_scrolling(music_systems_list));
  music_busy = true;
  render_rooms();
  assert(render_music_after_scroll.calls == 1 && !lv_obj_has_state(first, LV_STATE_DISABLED));
  lv_obj_stop_scroll_anim(music_systems_list);
  lv_obj_scroll_to_y(music_systems_list, 100, LV_ANIM_OFF);
  music_busy = true;
  render_rooms();
  assert(lv_obj_get_child(music_systems_list, 0) == first && lv_obj_get_scroll_y(music_systems_list) == scroll);
  assert(lv_obj_has_state(first, LV_STATE_DISABLED));
  music_busy = false; render_rooms();
  sonos.systems[2].name = "BUREAU";
  render_rooms();
  assert(lv_obj_get_child(music_systems_list, 0) == first && lv_obj_get_scroll_y(music_systems_list) == scroll);
  assert(std::string(lv_label_get_text(lv_obj_get_child(lv_obj_get_child(music_systems_list, 4), 0))) == "BUREAU");
  lv_obj_send_event(lv_obj_get_child(music_systems_list, 4), LV_EVENT_CLICKED, nullptr);
  assert(select_music_system.uuid == "Bureau");

  // Playback reordering really moves rows, but every retained/rebuilt callback
  // must select the UUID displayed there. Inventory order is never a room key.
  sonos.rooms[0].playing = false;
  sonos.rooms[1].playing = true;
  update_activity(); render_rooms();
  assert(row_uuid(0) == "Keuken" && row_uuid(1) == "Aanbouw");
  lv_obj_send_event(lv_obj_get_child(music_systems_list, 0), LV_EVENT_CLICKED, nullptr);
  assert(select_music_system.uuid == "Keuken");
  assert(lv_obj_get_scroll_y(music_systems_list) == scroll);
  sonos.systems.clear(); update_activity(); render_rooms();
  assert(lv_obj_get_child_count(music_systems_list) == 1);
  std::cout << "PASS: production LVGL room renderer retains widgets/scroll, updates labels, sorts playback and keeps UUID callbacks correct\n";
  lv_deinit();
}
