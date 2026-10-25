#pragma once
#include "lvgl.h"
#include <algorithm>
#include <cstdio>

namespace energydeck {
// Two adjacent labels keep the combined message on one line with semantic colors.
inline void set_weather_outlook(lv_obj_t *rain_label, lv_obj_t *sun_label,
                                const char *rain, const char *sun,
                                bool rain_expected, bool sun_expected) {
  char prefix[64];
  snprintf(prefix, sizeof(prefix), "%s | ", rain);
  lv_point_t size;
  lv_text_get_size(&size, prefix, &lv_font_montserrat_10, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
  const int width = std::min(231, int(size.x));
  lv_obj_set_style_text_font(rain_label, &lv_font_montserrat_10, LV_PART_MAIN);
  lv_obj_set_style_text_font(sun_label, &lv_font_montserrat_10, LV_PART_MAIN);
  lv_obj_set_width(rain_label, width);
  lv_obj_set_x(sun_label, 208 + width);
  lv_obj_set_width(sun_label, 232 - width);
  lv_label_set_text(rain_label, prefix);
  lv_label_set_text(sun_label, sun);
  lv_obj_set_style_text_color(rain_label, lv_color_hex(rain_expected ? 0x3AA7D8 : 0xA9B8AE), LV_PART_MAIN);
  lv_obj_set_style_text_color(sun_label, lv_color_hex(sun_expected ? 0xFFD35A : 0xA9B8AE), LV_PART_MAIN);
}
}  // namespace energydeck
