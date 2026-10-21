#pragma once

#include "esphome/core/component.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "lvgl.h"
#include "esphome/components/lvgl/lvgl_esphome.h"
#include "portrait_rotation.h"
#include "energy_state.h"
#include "energy_gauges.h"
#include "energy_history.h"
#include "energy_history_chart.h"
#include "ui_priority.h"
#ifdef USE_ESP32
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif
#include <array>
#include <cstdio>
#include <cstring>
#include <string>

namespace esphome::ui_performance {

// LVGL rebuilds label layout even for identical text. Skip unchanged snapshots
// so regular read-only polls do not invalidate the same text repeatedly.
inline void set_text(lv_obj_t *label, const char *text) {
  if (label == nullptr) return;
  const char *curr = lv_label_get_text(label);
  if (text == nullptr) {
    if (curr != nullptr && curr[0] != '\0') lv_label_set_text(label, "");
    return;
  }
  if (curr == nullptr || std::strcmp(curr, text) != 0)
    lv_label_set_text(label, text);
}

inline void set_text(lv_obj_t *label, const std::string &text) {
  set_text(label, text.c_str());
}

template <typename... Args>
inline void set_text_fmt(lv_obj_t *label, const char *fmt, Args... args) {
  if (label == nullptr || fmt == nullptr) return;
  char buf[256];
  std::snprintf(buf, sizeof(buf), fmt, args...);
  set_text(label, buf);
}

inline void set_bar_value(lv_obj_t *bar, int32_t value, lv_anim_enable_t anim = LV_ANIM_OFF) {
  if (bar == nullptr) return;
  if (lv_bar_get_value(bar) != value)
    lv_bar_set_value(bar, value, anim);
}

inline void set_arc_value(lv_obj_t *arc, int32_t value) {
  if (arc == nullptr) return;
  if (lv_arc_get_value(arc) != value)
    lv_arc_set_value(arc, value);
}

inline void set_style_text_color(lv_obj_t *obj, lv_color_t color, lv_part_t part = LV_PART_MAIN) {
  if (obj == nullptr) return;
  lv_color_t curr = lv_obj_get_style_text_color(obj, part);
  if (!lv_color_eq(curr, color))
    lv_obj_set_style_text_color(obj, color, part);
}

inline void set_style_bg_color(lv_obj_t *obj, lv_color_t color, lv_part_t part = LV_PART_MAIN) {
  if (obj == nullptr) return;
  lv_color_t curr = lv_obj_get_style_bg_color(obj, part);
  if (!lv_color_eq(curr, color))
    lv_obj_set_style_bg_color(obj, color, part);
}

inline void set_style_arc_color(lv_obj_t *obj, lv_color_t color, lv_part_t part = LV_PART_MAIN) {
  if (obj == nullptr) return;
  lv_color_t curr = lv_obj_get_style_arc_color(obj, part);
  if (!lv_color_eq(curr, color))
    lv_obj_set_style_arc_color(obj, color, part);
}

inline void set_style_border_color(lv_obj_t *obj, lv_color_t color, lv_part_t part = LV_PART_MAIN) {
  if (obj == nullptr) return;
  lv_color_t curr = lv_obj_get_style_border_color(obj, part);
  if (!lv_color_eq(curr, color))
    lv_obj_set_style_border_color(obj, color, part);
}

inline void set_style_border_width(lv_obj_t *obj, int32_t width, lv_part_t part = LV_PART_MAIN) {
  if (obj == nullptr) return;
  if (lv_obj_get_style_border_width(obj, part) != width)
    lv_obj_set_style_border_width(obj, width, part);
}

inline void set_pos(lv_obj_t *obj, int32_t x, int32_t y) {
  if (obj == nullptr) return;
  if (lv_obj_get_x(obj) != x || lv_obj_get_y(obj) != y)
    lv_obj_set_pos(obj, x, y);
}

inline void set_size(lv_obj_t *obj, int32_t w, int32_t h) {
  if (obj == nullptr) return;
  if (lv_obj_get_width(obj) != w || lv_obj_get_height(obj) != h)
    lv_obj_set_size(obj, w, h);
}

class UiPerformance : public Component {
 public:
  void set_benchmark_redraws(uint8_t count) { this->benchmark_left_ = count; }
  void set_display(display::Display *panel, bool tiled) { this->panel_ = panel; this->tiled_ = tiled; }
  float get_setup_priority() const override { return setup_priority::LATE; }
  void setup() override {
#ifdef USE_ESP32
    // ESPHome's loop normally shares priority 1 with network workers. Touch,
    // drawing and callbacks must preempt our lower-priority background tasks.
    vTaskPrioritySet(nullptr, 2);
#endif
    auto *display = lv_display_get_default();
    if (display == nullptr) { this->mark_failed(); return; }
    lv_display_add_event_cb(display, event_callback_, LV_EVENT_ALL, this);
    if (this->panel_ != nullptr && this->tiled_) {
      instance_ = this;
      // Keep LVGL's touch transform, page lifecycle and refresh events intact.
      // Only replace the synchronous RGB565 flush; unsupported modes fall back
      // to ESPHome's public callback. No ESPHome core files are patched.
      lv_display_set_flush_cb(display, tiled_flush_);
    }
    // Opt-in redraws only invalidate the current screen. They never click a
    // button, switch a page, or invoke Homey/Sonos commands.
    this->set_timeout("benchmark", 30000, [this]() {
      if (this->benchmark_left_ == 0) return;
      this->set_interval("benchmark", 3000, [this]() {
        if (this->benchmark_pending_) return;
        this->benchmark_pending_ = true;
        lv_obj_invalidate(lv_screen_active());
        if (--this->benchmark_left_ == 0) this->cancel_interval("benchmark");
      });
    });
  }

 protected:
  static void tiled_flush_(lv_display_t *display, const lv_area_t *area, uint8_t *pixels) {
    auto *self = instance_;
    auto *ui = static_cast<lvgl::LvglComponent *>(lv_display_get_user_data(display));
    if (self == nullptr || ui->is_paused() || ui->get_rotation() != display::DISPLAY_ROTATION_90_DEGREES ||
        self->panel_->get_rotation() != display::DISPLAY_ROTATION_0_DEGREES ||
        lv_display_get_color_format(display) != LV_COLOR_FORMAT_RGB565) {
      lvgl::LvglComponent::static_flush_cb(display, area, pixels);
      return;
    }
    const int width = lv_area_get_width(area);
    const int height = lv_area_get_height(area);
    const auto *source = reinterpret_cast<const uint16_t *>(pixels);
    // A full strided transpose repeatedly evicts dirty PSRAM cache lines.
    // Transpose 32x32 pixels in a 2 KB internal tile, then copy each packed
    // rectangle to the existing RGB framebuffer. Handle partial edge tiles.
    for (int y = 0; y < height; y += TILE_SIDE) {
      const int h = std::min(TILE_SIDE, height - y);
      for (int x = 0; x < width; x += TILE_SIDE) {
        const int w = std::min(TILE_SIDE, width - x);
        rotate_portrait_tile(source + y * width + x, width, w, h, self->tile_.data());
        self->panel_->draw_pixels_at(self->panel_->get_native_width() - area->y1 - y - h,
                                    area->x1 + x, h, w, reinterpret_cast<const uint8_t *>(self->tile_.data()),
                                    display::COLOR_ORDER_RGB, display::COLOR_BITNESS_565, true);
      }
    }
    lv_display_flush_ready(display);
  }
  static void event_callback_(lv_event_t *event) {
    auto *self = static_cast<UiPerformance *>(lv_event_get_user_data(event));
    switch (lv_event_get_code(event)) {
      case LV_EVENT_RENDER_START:
        self->render_started_ = micros();
        self->flush_us_ = 0;
        self->pixels_ = 0;
        break;
      case LV_EVENT_FLUSH_START: {
        self->flush_started_ = micros();
        auto *area = static_cast<lv_area_t *>(lv_event_get_param(event));
        self->pixels_ += lv_area_get_width(area) * lv_area_get_height(area);
        break;
      }
      case LV_EVENT_FLUSH_FINISH:
        self->flush_us_ += micros() - self->flush_started_;
        break;
      case LV_EVENT_RENDER_READY: {
        const uint32_t total = micros() - self->render_started_;
        // Flush includes ESPHome's software rotation and framebuffer copy;
        // the remainder is LVGL drawing. Both run on the main event loop.
        if (self->benchmark_pending_ || total >= 100000) {
          ESP_LOGI("ui_performance", "%s: pixels=%u total=%.1f ms draw=%.1f ms rotate/copy=%.1f ms",
                   self->benchmark_pending_ ? "Benchmark" : "Render", static_cast<unsigned>(self->pixels_),
                   total / 1000.0f, (total - self->flush_us_) / 1000.0f, self->flush_us_ / 1000.0f);
        }
        self->benchmark_pending_ = false;
        break;
      }
      default:
        break;
    }
  }
  uint32_t render_started_{0}, flush_started_{0}, flush_us_{0}, pixels_{0};
  uint8_t benchmark_left_{0};
  bool benchmark_pending_{false};
  static constexpr int TILE_SIDE = 32;
  inline static UiPerformance *instance_{nullptr};
  display::Display *panel_{nullptr};
  bool tiled_{false};
  std::array<uint16_t, TILE_SIDE * TILE_SIDE> tile_{};
};

}  // namespace esphome::ui_performance
