#pragma once
#include "lvgl.h"

namespace esphome::ui_performance {
// Read only on the main thread. Input and momentum take precedence over data
// publication/decoding results, with a short quiet window after the last touch.
inline bool background_allowed() {
  auto *display = lv_display_get_default();
  if (!display) return true;
  for (auto *input = lv_indev_get_next(nullptr); input; input = lv_indev_get_next(input)) {
    if (lv_indev_get_state(input) == LV_INDEV_STATE_PRESSED || lv_indev_get_scroll_obj(input)) return false;
  }
  return lv_display_get_inactive_time(display) >= 150;
}
}  // namespace esphome::ui_performance
