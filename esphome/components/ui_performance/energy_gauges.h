#pragma once

#include "lvgl.h"
#include <cmath>

namespace energydeck {
inline int power_arc_value(float watts) {
  if (!std::isfinite(watts)) return 0;
  // Each half of a directional gauge represents 5 kW. Clamp before converting
  // so even an out-of-range source cannot overflow the integer LVGL value.
  return static_cast<int>(std::round(std::fmax(-100.0f, std::fmin(100.0f, watts / 50.0f))));
}

inline void set_power_arc(lv_obj_t *arc, float watts, bool directional) {
  const auto mode = directional ? LV_ARC_MODE_SYMMETRICAL : LV_ARC_MODE_NORMAL;
  const int minimum = directional ? -100 : 0;
  // A 135°..45° background passes through 270° (12 o'clock) at its midpoint.
  // Negative power fills left from there; positive power fills right.
  if (lv_arc_get_mode(arc) != mode) lv_arc_set_mode(arc, mode);
  if (lv_arc_get_min_value(arc) != minimum || lv_arc_get_max_value(arc) != 100)
    lv_arc_set_range(arc, minimum, 100);
  const int signed_value = power_arc_value(watts);
  const int value = directional || signed_value >= 0 ? signed_value : 0;
  if (lv_arc_get_value(arc) != value) lv_arc_set_value(arc, value);
}
}  // namespace energydeck
