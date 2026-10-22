#pragma once
#include <cstdint>
namespace energydeck {
struct HomeCards {
  int previous{-1};
  bool music{false};
  int update(int current, bool playing, bool stopped, bool heating, uint32_t idle_ms = 0) {
    // Unknown/transitioning Sonos replies cannot establish that playback ended.
    if (playing) music = true;
    else if (stopped) music = false;
    const int preferred = music ? 1 : heating ? 2 : 0;
    const bool changed = preferred != previous;
    previous = preferred;
    // Resume automatic selection after five minutes without actual input.
    return changed || idle_ms >= 300000 ? preferred : current;
  }
};
}  // namespace energydeck
