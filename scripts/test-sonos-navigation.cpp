// The runner inserts the production refresh navigation lambda at the marker.
#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <iostream>
#define id(value) (value)

static energydeck_sonos::State sonos;
static bool music_page_open, music_busy, music_favorite_pending, music_control_pending;
static bool music_selection_loading, music_room_refresh_pending;
static int detail_tab;
struct ClosePage {
  int calls = 0;
  void execute() {
    ++calls;
    music_page_open = false;
    detail_tab = 1;  // Normal Back returns to the compact Sonos card.
  }
} close_music_page;
static void navigate() {
// PRODUCTION_NAVIGATION
}
static void playback(bool playing) {
  for (auto &room : sonos.rooms) {
    room.topology = room.transport = room.media = room.position = true;
    room.playing = playing;
    room.transitioning = false;
  }
  sonos.set_system_activity(playing, !playing);
}
static void reset() {
  sonos = energydeck_sonos::State{};
  music_page_open = music_busy = music_favorite_pending = music_control_pending = false;
  music_selection_loading = music_room_refresh_pending = false;
  detail_tab = 0;
  close_music_page.calls = 0;
  playback(false);
}
static void start_detail() {
  reset();
  playback(true);
  navigate();
  assert(detail_tab == 1 && !music_page_open); // A start only changes the compact card.
  music_page_open = true;
}
int main() {
  start_detail();
  playback(false);
  navigate();
  assert(!music_page_open && detail_tab == 0 && close_music_page.calls == 1);
  navigate();
  assert(close_music_page.calls == 1); // A stop is handled only once.
  music_page_open = true;
  detail_tab = 1;
  navigate();
  assert(music_page_open && detail_tab == 1); // Reopening idle detail remains useful.

  reset();
  playback(true); navigate();
  playback(false); navigate();
  assert(detail_tab == 0 && close_music_page.calls == 0); // Compact also returns home.
  playback(true); navigate();
  detail_tab = 2;
  playback(false); navigate();
  assert(detail_tab == 2); // A manually selected Climate card is preserved.

  start_detail();
  playback(false);
  sonos.rooms[0].transport = false;
  navigate();
  assert(music_page_open && detail_tab == 1); // Offline is not a confirmed stop.
  playback(true); navigate();
  assert(music_page_open); // Recovery is not a stop.
  playback(false);
  sonos.rooms[0].transitioning = true;
  navigate();
  assert(music_page_open);
  playback(false);
  sonos.set_system_activity(false, false);
  navigate();
  assert(music_page_open); // Incomplete all-room activity cannot dismiss detail.
  sonos.set_system_activity(true, false);
  navigate();
  assert(music_page_open); // Another playing room keeps the player visible.
  playback(false); navigate();
  assert(!music_page_open && detail_tab == 0);

  for (bool *pending : {&music_busy, &music_favorite_pending, &music_control_pending,
                        &music_selection_loading, &music_room_refresh_pending}) {
    start_detail();
    playback(false);
    *pending = true;
    // Loading remains pending until the queued room refresh is drained.
    if (pending == &music_selection_loading) music_room_refresh_pending = true;
    navigate();
    assert(music_page_open && detail_tab == 1 && close_music_page.calls == 0);
    *pending = false;
    music_room_refresh_pending = false;
    navigate();
    assert(!music_page_open && detail_tab == 0); // Do not lose a deferred stop edge.
  }
  start_detail();
  music_favorite_pending = true;
  playback(false); navigate();
  playback(true);
  music_favorite_pending = false;
  navigate();
  assert(music_page_open && detail_tab == 1); // A favorite can stop before starting.
  std::cout << "PASS: production Sonos navigation, detail/compact stop, idle reopening, unknown/transitioning activity and pending operations\n";
}
