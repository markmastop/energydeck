// The runner inserts the actual production room-render lambda at the marker.
#include "lvgl.h"
#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <functional>
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
template<typename... Args> void set_text_fmt(lv_obj_t *label, const char *format, Args... args) {
  char text[512]; std::snprintf(text, sizeof(text), format, args...); lv_label_set_text(label, text);
}
inline void set_text(lv_obj_t *label, const char *text) {
  if (std::strcmp(lv_label_get_text(label), text)) lv_label_set_text(label, text);
}
}
struct ScriptProbe {
  std::string uuid;
  int calls{0};
  std::function<void(const std::string &)> on_select;
  void execute() { ++calls; }
  void execute(const std::string &value) { uuid = value; ++calls; if (on_select) on_select(value); }
};
static energydeck_sonos::State sonos;
static energydeck_sonos::Queue sonos_queue;
static lv_obj_t *music_queue_list, *music_queue_badge, *music_next_track, *music_next_caption;
static energydeck_sonos::RoomActivity sonos_room_activity;
static bool music_page_open = true, music_busy = false, music_favorite_pending = false;
static int music_content_tab = 1;
static lv_obj_t *music_systems_list, *music_group_apply, *music_group_reset;
static lv_obj_t *music_cover_widget, *small_music_cover_widget;
static bool music_control_pending = true, music_command_failed = true;
static bool music_room_refresh_pending = false, music_selection_loading = false;
static std::string music_cover_key = "previous room";
static ScriptProbe select_music_system, render_music, render_music_after_scroll;
static lv_point_t touch_point;
static lv_indev_state_t touch_state = LV_INDEV_STATE_RELEASED;

static bool should_request() {
// PRODUCTION_REQUEST_GUARD
}
static bool should_submit_after_wait() {
// PRODUCTION_SUBMIT_GUARD
}
static void test_request_priority() {
  sonos.begin("http://192.168.1.50:1400", "http://192.168.1.51:1400");
  assert(should_request() && should_submit_after_wait());
  // A click arriving during I/O or another owner's worker wait stops the old
  // queue, even if its failed read would otherwise get a retry.
  music_room_refresh_pending = true;
  sonos.accept(0, "");
  assert(sonos.has_request() && !should_request() && !should_submit_after_wait());
  music_busy = true;
  assert(should_request() && should_submit_after_wait()); // Command preflights/writes still drain.
  music_busy = music_room_refresh_pending = false;
  sonos = energydeck_sonos::State{};
}
static void render_rooms() {
// PRODUCTION_ROOM_RENDER
}
static void render_queue() {
// PRODUCTION_QUEUE_RENDER
}
static void select_room(const std::string &uuid) {
// PRODUCTION_ROOM_SELECT
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
  test_request_priority();
  lv_init();
  auto *display = lv_display_create(480, 800);
  static uint16_t pixels[480 * 40];
  lv_display_set_buffers(display, pixels, nullptr, sizeof(pixels), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display, [](lv_display_t *d, const lv_area_t *, uint8_t *) { lv_display_flush_ready(d); });
  lv_group_set_default(lv_group_create()); // Production touch also focuses rows.
  auto *touch = lv_indev_create();
  lv_indev_set_type(touch, LV_INDEV_TYPE_POINTER);
  lv_indev_set_mode(touch, LV_INDEV_MODE_EVENT);
  lv_indev_set_read_cb(touch, [](lv_indev_t *, lv_indev_data_t *data) {
    data->point = touch_point; data->state = touch_state;
  });
  music_systems_list = lv_obj_create(lv_screen_active());
  lv_obj_remove_style_all(music_systems_list);
  lv_obj_set_size(music_systems_list, 452, 180);
  music_group_apply = lv_button_create(lv_screen_active());
  music_group_reset = lv_button_create(lv_screen_active());
  music_cover_widget = lv_image_create(lv_screen_active());
  small_music_cover_widget = lv_image_create(lv_screen_active());
  select_music_system.on_select = [](const std::string &uuid) { select_room(uuid); render_rooms(); };
  // Keep unrelated controls outside the list, as on the real Sonos page.
  lv_obj_set_pos(music_group_apply, 0, 200);
  lv_obj_set_pos(music_group_reset, 200, 200);
  lv_label_create(music_group_apply); lv_label_create(music_group_reset);
  sonos.systems_known = sonos.systems_complete = true;
  for (const auto &name : {"Woonkamer", "Aanbouw", "Bureau", "Keuken", "Slaapkamer", "Zolder"})
    sonos.systems.push_back({name, name, name, "http://192.168.1.50:1400", "http://192.168.1.50:1400", name});
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
  assert(sonos.current().uuid == "Bureau" && !music_busy);
  assert(music_room_refresh_pending && music_selection_loading);
  assert(!music_control_pending && !music_command_failed && music_cover_key.empty());
  assert(lv_obj_has_flag(music_cover_widget, LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_has_flag(small_music_cover_widget, LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_get_style_border_width(lv_obj_get_child(music_systems_list, 4), LV_PART_MAIN) == 2);
  assert(!lv_obj_has_state(lv_obj_get_child(music_systems_list, 0), LV_STATE_DISABLED));

  // Touch a partly visible last row before dragging it. Focus must not launch
  // a competing scroll-to-view animation, and dragging must not choose a room.
  lv_obj_scroll_to_y(music_systems_list, 0, LV_ANIM_OFF);
  lv_obj_update_layout(music_systems_list);
  lv_area_t viewport;
  lv_obj_get_coords(music_systems_list, &viewport);
  const auto calls_before_drag = select_music_system.calls;
  touch_point = {viewport.x1 + 20, viewport.y1 + 174};
  touch_state = LV_INDEV_STATE_PRESSED;
  lv_indev_read(touch);
  assert(!lv_obj_is_scrolling(music_systems_list)); // No focus animation on touch-down.
  for (int i = 0; i < 5; ++i) {
    touch_point.y -= 20;
    lv_tick_inc(20); lv_indev_read(touch);
  }
  assert(lv_obj_get_scroll_y(music_systems_list) >= 80);
  assert(lv_indev_get_scroll_obj(touch) == music_systems_list);
  touch_state = LV_INDEV_STATE_RELEASED;
  lv_indev_read(touch);
  assert(select_music_system.calls == calls_before_drag);
  for (int i = 0; i < 200 && lv_obj_is_scrolling(music_systems_list); ++i) {
    lv_tick_inc(20); lv_timer_handler();
  }
  assert(!lv_obj_is_scrolling(music_systems_list));
  lv_obj_stop_scroll_anim(music_systems_list);
  lv_obj_scroll_to_y(music_systems_list, 0, LV_ANIM_OFF);
  touch_point = {viewport.x1 + 20, viewport.y1 + 20};
  touch_state = LV_INDEV_STATE_PRESSED; lv_indev_read(touch);
  touch_state = LV_INDEV_STATE_RELEASED; lv_indev_read(touch);
  assert(select_music_system.calls == calls_before_drag + 1);
  assert(select_music_system.uuid == "Woonkamer"); // A real tap still selects the displayed UUID.
  lv_obj_scroll_to_y(music_systems_list, 100, LV_ANIM_OFF);

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
  std::cout << "PASS: production queue guards prioritize selection; LVGL highlights immediately, hides stale covers, retains scroll and drags/taps correctly\n";
  music_queue_list = lv_obj_create(lv_screen_active());
  lv_obj_remove_style_all(music_queue_list);
  lv_obj_set_size(music_queue_list, 452, 200);
  music_queue_badge = lv_label_create(lv_screen_active());
  music_next_caption = lv_label_create(lv_screen_active());
  music_next_track = lv_label_create(lv_screen_active());
  music_content_tab = 2; sonos = energydeck_sonos::State{};
  auto &room = sonos.rooms[0];
  room.topology = room.transport = room.media = room.position = true;
  room.coordinator_host = "http://192.168.1.50:1400";
  room.uri = "x-rincon-queue:ROOM#0"; room.track = 4;
  sonos_queue.begin(room.coordinator_host, room.uri, room.track, true);
  sonos_queue.accept(200, "<GetTransportSettingsResponse><PlayMode>NORMAL</PlayMode></GetTransportSettingsResponse>");
  std::string result = "<DIDL-Lite>";
  for (const auto &title : {"One", "Two", "Three", "Four", "Five"})
    result += std::string("<item><title>") + title + "</title><creator>Artist</creator></item>";
  result += "</DIDL-Lite>";
  sonos_queue.accept(200, "<BrowseResponse><NumberReturned>5</NumberReturned><TotalMatches>5</TotalMatches><UpdateID>1</UpdateID><Result>" + energydeck_sonos::xml_escape(result) + "</Result></BrowseResponse>");
  render_queue();
  assert(!std::strcmp(lv_label_get_text(music_queue_badge), "5"));
  assert(lv_obj_get_child_count(music_queue_list) == 5);
  assert(std::strstr(lv_label_get_text(music_next_track), "Five\nArtist"));
  assert(!lv_obj_has_flag(music_next_caption, LV_OBJ_FLAG_HIDDEN));
  lv_obj_update_layout(music_queue_list);
  assert(lv_obj_get_y(lv_obj_get_child(music_queue_list, 3)) + 24 - lv_obj_get_scroll_y(music_queue_list) == 100);
  lv_obj_scroll_to_y(music_queue_list, 0, LV_ANIM_OFF); // Same-track polls respect a manual position.
  auto *retained = lv_obj_get_child(music_queue_list, 0); render_queue();
  assert(lv_obj_get_scroll_y(music_queue_list) == 0);
  assert(lv_obj_get_child(music_queue_list, 0) == retained);
  room.track = 5; render_queue(); // Late snapshots cannot describe the newly selected/current track.
  assert(!std::strcmp(lv_label_get_text(music_queue_badge), "--"));
  assert(!std::strlen(lv_label_get_text(music_next_track)));
  assert(lv_obj_has_flag(music_next_caption, LV_OBJ_FLAG_HIDDEN));
  assert(lv_obj_get_child_count(music_queue_list) == 1);
  for (int track : {1, 5}) {
    room.track = track;
    sonos_queue.begin(room.coordinator_host, room.uri, room.track, true);
    sonos_queue.accept(200, "<GetTransportSettingsResponse><PlayMode>NORMAL</PlayMode></GetTransportSettingsResponse>");
    sonos_queue.accept(200, "<BrowseResponse><NumberReturned>5</NumberReturned><TotalMatches>5</TotalMatches><UpdateID>1</UpdateID><Result>" + energydeck_sonos::xml_escape(result) + "</Result></BrowseResponse>");
    render_queue(); lv_obj_update_layout(music_queue_list);
    assert(lv_obj_get_y(lv_obj_get_child(music_queue_list, track - 1)) + 24 - lv_obj_get_scroll_y(music_queue_list) == 100);
  }
  room.uri = "x-sonosapi-stream:radio";
  sonos_queue.begin(room.coordinator_host, room.uri, room.track, true); render_queue();
  assert(!std::strcmp(lv_label_get_text(music_queue_badge), "0"));
  assert(lv_obj_get_child_count(music_queue_list) == 1);
  std::cout << "PASS: production LVGL queue count, next track, retained rows, stale-snapshot clearing and radio state\n";
  lv_deinit();
}
