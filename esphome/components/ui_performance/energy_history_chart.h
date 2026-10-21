#pragma once
#include "energy_history.h"
#include "lvgl.h"

namespace energydeck {
struct HistoryChart {
  lv_obj_t *plot{nullptr};
  const LineHistory *data{nullptr};
  bool signed_power{false};
  float maximum{1};

  void attach(lv_obj_t *object, bool power) {
    if (plot) return;
    plot = object; signed_power = power;
    // Draw into the existing object instead of allocating hundreds of line
    // widgets. The chart and source model outlive the registered draw callback.
    lv_obj_add_event_cb(plot, [](lv_event_t *event) {
      auto *chart = static_cast<HistoryChart *>(lv_event_get_user_data(event));
      lv_area_t area; lv_obj_get_coords(chart->plot, &area);
      const float width = lv_area_get_width(&area) - 4, height = lv_area_get_height(&area) - 4;
      auto *layer = lv_event_get_layer(event);
      auto line = [&](float x1, float y1, float x2, float y2, uint32_t color, int thickness) {
        lv_draw_line_dsc_t dsc; lv_draw_line_dsc_init(&dsc);
        dsc.p1 = {static_cast<lv_value_precise_t>(std::round(area.x1 + 2 + x1 * width)),
                  static_cast<lv_value_precise_t>(std::round(area.y1 + 2 + y1 * height))};
        dsc.p2 = {static_cast<lv_value_precise_t>(std::round(area.x1 + 2 + x2 * width)),
                  static_cast<lv_value_precise_t>(std::round(area.y1 + 2 + y2 * height))};
        dsc.color = lv_color_hex(color); dsc.width = thickness;
        lv_draw_line(layer, &dsc);
      };
      const float zero = chart->signed_power ? .5f : 1.f;
      line(0, zero, 1, zero, 0x82958A, 1);
      if (!chart->data) return;
      chart->data->segments(chart->signed_power, chart->maximum,
        [&](float x1, float y1, float x2, float y2, bool negative) {
          line(x1, y1, x2, y2, chart->signed_power ? (negative ? 0x48BD70 : 0x3AA7D8) : 0xFF3485, 2);
        });
    }, LV_EVENT_DRAW_MAIN, this);
  }
  float update(const LineHistory *source) {
    data = source;
    maximum = source ? source->scale(signed_power ? .5f : .1f) : (signed_power ? .5f : .1f);
    lv_obj_invalidate(plot);
    return maximum;
  }
};
}  // namespace energydeck
