#pragma once
#include "energy_history.h"
#include "lvgl.h"
#include <cstdio>

namespace energydeck {
// Fixed hour slots share one scale; future/missing hours remain empty. The two
// electricity bars show volumes independently rather than cancelling export.
inline double draw_history(lv_obj_t *plot, const HourlyHistory *a, const HourlyHistory *b,
                           uint32_t color_a, uint32_t color_b, double step, bool dual = false) {
  const int series = dual || b ? 2 : 1;
  const int count = 24 * series;
  if (lv_obj_get_child_count(plot) == 0) {
    for (int i = 0; i < count; ++i) {
      auto *bar = lv_obj_create(plot);
      lv_obj_remove_style_all(bar);
      lv_obj_remove_flag(bar, LV_OBJ_FLAG_CLICKABLE);
      lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
      lv_obj_set_style_radius(bar, 1, 0);
    }
  }
  const double peak = std::max(a ? a->maximum() : 0, b ? b->maximum() : 0);
  const double scale = std::max(step, std::ceil(peak / step) * step);
  for (int hour = 0; hour < 24; ++hour) {
    for (int s = 0; s < series; ++s) {
      auto *bar = lv_obj_get_child(plot, hour * series + s);
      const auto *data = s ? b : a;
      if (!data || !data->valid(hour)) {
        lv_obj_add_flag(bar, LV_OBJ_FLAG_HIDDEN);
        continue;
      }
      lv_obj_remove_flag(bar, LV_OBJ_FLAG_HIDDEN);
      const int height = std::max(1, static_cast<int>(std::round(data->values[hour] / scale * 126)));
      lv_obj_set_pos(bar, hour * 17 + s * 7, 128 - height);
      lv_obj_set_size(bar, series == 2 ? 6 : 12, height);
      lv_obj_set_style_bg_color(bar, lv_color_hex(s ? color_b : color_a), 0);
    }
  }
  return scale;
}
}  // namespace energydeck
