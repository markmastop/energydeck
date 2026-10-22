#pragma once
namespace energydeck {
struct HomeCards {
  int previous{-1};
  bool music{false};
  int update(int current, bool playing, bool stopped, bool heating) {
    // Unknown/transitioning Sonos replies cannot establish that playback ended.
    if (playing) music = true;
    else if (stopped) music = false;
    const int preferred = music ? 1 : heating ? 2 : 0;
    const bool changed = preferred != previous;
    previous = preferred;
    // Preserve a manual selection until the activity-driven priority changes.
    return changed ? preferred : current;
  }
};
}  // namespace energydeck
