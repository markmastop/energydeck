#pragma once
#include "battery_detail.h"
#include "battery_soc_chart.h"
#include "lvgl.h"

namespace energydeck {
class BatteryStrategyChart {
  std::array<lv_obj_t *, 145> phases_{}, sun_{};
  BatterySocChart soc_;
  lv_obj_t *now_{nullptr};
 public:
  void draw(lv_obj_t *parent, const BatteryPlan *p, int64_t from, int64_t until, uint32_t now, const LineHistory *history = nullptr, float live = NAN) {
    soc_.update(parent,history,p,from,until,now,live,3,41);
    for (const auto *items : {&phases_, &sun_}) for (auto *o : *items) if (o) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
    if(now_) lv_obj_add_flag(now_, LV_OBJ_FLAG_HIDDEN);
    if ((!p && !history) || from <= 0 || until <= from) return;
    auto rect = [&](lv_obj_t *&o, int x, int y, int w, int h, uint32_t color, lv_opa_t opacity = LV_OPA_COVER) {
      if (!o) { o = lv_obj_create(parent); lv_obj_remove_style_all(o); lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE); lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE); }
      lv_obj_set_pos(o, x, y); lv_obj_set_size(o, std::max(1, w), h);
      lv_obj_set_style_bg_color(o, lv_color_hex(color), 0); lv_obj_set_style_bg_opa(o, opacity, 0);
      lv_obj_clear_flag(o, LV_OBJ_FLAG_HIDDEN);
    };
    const BatteryStrategyWindow window{from, until};
    const int w = lv_obj_get_width(parent);

    for (size_t i = 0; p && i < p->interval_count; i++) {
      const auto &q = p->intervals[i]; int64_t a, b;
      if (!window.clip(q, a, b)) continue;
      const int x = window.x(a, w), width = window.x(b, w) - x;
      rect(phases_[i], x, 0, width, 44, q.action == 1 ? 0x3AA7D8 : q.action == 2 ? 0xE7A052 : 0x617064, LV_OPA_20);
      if (std::isfinite(q.sun)) rect(sun_[i], x, 0, q.sun > 0 ? std::max(1, int(width * q.sun)) : width, 2, q.sun > 0 ? 0xFFD35A : 0x34443A);
    }
    if (now >= from && now < until) { rect(now_, window.x(now, w), 0, 1, 44, 0xEEF6F0); lv_obj_move_foreground(now_); }
  }
};
class BatteryDetailChart {
  std::array<lv_obj_t *, 145> prices_{}, power_{}, sun_{};
  lv_obj_t *price_parent_{nullptr}, *power_parent_{nullptr}, *sun_parent_{nullptr};
  lv_obj_t *price_now_{nullptr}, *power_now_{nullptr}, *price_selected_{nullptr}, *power_selected_{nullptr};
  lv_obj_t *measured_{nullptr}, *price_zero_{nullptr}, *power_zero_{nullptr};
  BatterySocChart soc_;
  uint32_t drawn_at_{0};
  int64_t drawn_from_{0};
  static lv_obj_t *rectangle(lv_obj_t *parent) {
    auto *o = lv_obj_create(parent); lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE); lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, LV_PART_MAIN); return o;
  }
  static void place(lv_obj_t *o, int x, int y, int w, int h, uint32_t color) {
    lv_obj_set_pos(o, x, y); lv_obj_set_size(o, std::max(1, w), std::max(1, h));
    lv_obj_set_style_bg_color(o, lv_color_hex(color), LV_PART_MAIN); lv_obj_clear_flag(o, LV_OBJ_FLAG_HIDDEN);
  }
 public:
  void attach(lv_obj_t *price, lv_obj_t *power, lv_obj_t *sun) {
    if (price_parent_) return;
    price_parent_ = price; power_parent_ = power; sun_parent_ = sun;
    price_zero_ = rectangle(price); power_zero_ = rectangle(power);
    price_now_ = rectangle(price); power_now_ = rectangle(power);
    price_selected_ = rectangle(price); power_selected_ = rectangle(power);
    measured_ = rectangle(power); lv_obj_set_style_radius(measured_, LV_RADIUS_CIRCLE, LV_PART_MAIN);

  }
  void draw(const BatteryPlan *p, uint32_t now, uint32_t selection, float actual, const LineHistory *history = nullptr, float live = NAN) {
    if (!price_parent_) return;
    const auto start = history ? history->day_start : p ? p->intervals[0].from : 0;
    soc_.update(power_parent_,history,p,start,p ? p->intervals[p->interval_count-1].until : history ? history->day_end : 0,now,live,0,lv_obj_get_height(power_parent_));
    if (!p) {
      for (const auto *items : {&prices_, &power_, &sun_}) for (auto *o : *items) if (o) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
      for (auto *o : {price_zero_, power_zero_, price_now_, power_now_, price_selected_, power_selected_, measured_}) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
      drawn_at_ = 0; return;
    }
    const BatteryDetailGeometry g(*p,start);
    const int w = lv_obj_get_width(price_parent_), h = lv_obj_get_height(price_parent_);
    const int index = g.selected(selection, now);
    if (drawn_at_ != p->updated_at || drawn_from_ != start) {
      for (size_t i = 0; i < prices_.size(); i++) {
        if (i >= p->interval_count) {
          for (auto *o : {prices_[i], power_[i], sun_[i]}) if (o) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
          continue;
        }
        const auto &q = p->intervals[i];
        const int left = g.x(q.from, w), width = std::max(1, g.x(q.until, w) - left - 1);
        if (!prices_[i]) { prices_[i] = rectangle(price_parent_); power_[i] = rectangle(power_parent_); }
        const int py = g.price_y(q.price, h), zero = g.price_y(0, h), wy = g.power_y(q.watts, h), wz = g.power_y(0, h);
        place(prices_[i], left, std::min(py, zero), width, std::max(1, std::abs(py - zero)), 0xA9B8AE);
        place(power_[i], left, std::min(wy, wz), width, std::max(1, std::abs(wy - wz)), q.action == 1 ? 0x3AA7D8 : q.action == 2 ? 0xE7A052 : 0x617064);
        if (sun_[i]) lv_obj_add_flag(sun_[i], LV_OBJ_FLAG_HIDDEN);
        if (std::isfinite(q.sun)) {
          if (!sun_[i]) sun_[i] = rectangle(sun_parent_);
          place(sun_[i], left, q.sun > 0 ? 0 : 3, q.sun > 0 ? std::max(1, int(width * q.sun)) : width, q.sun > 0 ? 5 : 2, q.sun > 0 ? 0xFFD35A : 0x617064);
        }
      }
      drawn_at_ = p->updated_at; drawn_from_=start;
    }
    place(price_zero_, 0, g.price_y(0, h), w, 1, 0x617064);
    place(power_zero_, 0, g.power_y(0, h), w, 1, 0x617064);
    for (auto *o : {price_now_, power_now_}) { place(o, g.x(now, w), 0, 1, h, 0x617064); lv_obj_move_foreground(o); }
    if (index >= 0) for (auto *o : {price_selected_, power_selected_}) { place(o, g.x(p->intervals[index].from, w), 0, 1, h, 0xEEF6F0); lv_obj_move_foreground(o); }
    if (std::isfinite(actual)) { place(measured_, g.x(now, w) - 2, g.power_y(actual, h) - 2, 5, 5, 0xEEF6F0); lv_obj_move_foreground(measured_); }
    else lv_obj_add_flag(measured_, LV_OBJ_FLAG_HIDDEN);
  }
};
}  // namespace energydeck
