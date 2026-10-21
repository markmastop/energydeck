#include "lvgl.h"
#include "../esphome/components/ui_performance/energy_gauges.h"
#include "../esphome/components/ui_performance/energy_history_chart.h"
#include <cassert>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>

extern "C" {
void lv_mem_init() {}
void lv_mem_deinit() {}
void *lv_malloc_core(size_t size) { return std::malloc(size); }
void *lv_realloc_core(void *pointer, size_t size) { return std::realloc(pointer, size); }
void lv_free_core(void *pointer) { std::free(pointer); }
void lv_mem_monitor_core(lv_mem_monitor_t *monitor) { std::memset(monitor, 0, sizeof(*monitor)); }
lv_result_t lv_mem_test_core() { return LV_RESULT_OK; }
}

int main() {
  lv_init();
  lv_display_create(480, 800);
  auto *grid = lv_arc_create(lv_screen_active());
  auto *source = lv_arc_create(lv_screen_active());
  // PRODUCTION_ARC_CONFIG
  for (auto *arc : {grid, source}) {
    // Test actual LVGL geometry, not just the signed model values. LVGL angles
    // increase clockwise from 3 o'clock, so the top midpoint must be 270°.
    energydeck::set_power_arc(arc, -2500, true);
    assert(lv_arc_get_min_value(arc) == -100 && lv_arc_get_max_value(arc) == 100);
    assert(lv_arc_get_value(arc) == -50 && lv_arc_get_mode(arc) == LV_ARC_MODE_SYMMETRICAL);
    assert(lv_arc_get_angle_start(arc) > 135 && lv_arc_get_angle_start(arc) < 270);
    assert(lv_arc_get_angle_end(arc) == 270);
    energydeck::set_power_arc(arc, 2500, true);
    assert(lv_arc_get_value(arc) == 50 && lv_arc_get_angle_start(arc) == 270);
    assert(lv_arc_get_angle_end(arc) > 270 && lv_arc_get_angle_end(arc) < 360);
    energydeck::set_power_arc(arc, 0, true);
    assert(lv_arc_get_angle_start(arc) == 270 && lv_arc_get_angle_end(arc) == 270);
    energydeck::set_power_arc(arc, -std::numeric_limits<float>::max(), true);
    assert(lv_arc_get_value(arc) == -100 && lv_arc_get_angle_start(arc) == 135);
    energydeck::set_power_arc(arc, std::numeric_limits<float>::max(), true);
    assert(lv_arc_get_value(arc) == 100 && lv_arc_get_angle_end(arc) == 45);
    energydeck::set_power_arc(arc, NAN, true);
    assert(lv_arc_get_value(arc) == 0 && lv_arc_get_angle_start(arc) == lv_arc_get_angle_end(arc));
  }
  // A source switch must restore both the range and the origin, including
  // transitions where the current value is zero in both modes.
  energydeck::set_power_arc(source, 2500, false);
  assert(lv_arc_get_mode(source) == LV_ARC_MODE_NORMAL && lv_arc_get_min_value(source) == 0);
  assert(lv_arc_get_angle_start(source) == 135 && lv_arc_get_angle_end(source) == 270);
  energydeck::set_power_arc(source, 0, true);
  assert(lv_arc_get_angle_start(source) == 270 && lv_arc_get_angle_end(source) == 270);
  energydeck::set_power_arc(source, 0, false);
  assert(lv_arc_get_angle_start(source) == 135 && lv_arc_get_angle_end(source) == 135);
  energydeck::set_power_arc(source, -2500, false);
  assert(lv_arc_get_value(source) == 0);
  // Partial electricity failures must hide only the missing series, retain the
  // shared scale, and never leave old export bars behind in a single-series draw.
  auto *plot = lv_obj_create(lv_screen_active());
  energydeck::HourlyHistory imported, exported;
  imported.loaded = exported.loaded = true;
  imported.values[0] = 1; exported.values[0] = .5;
  imported.seconds[0] = exported.seconds[0] = 300;
  imported.seconds[1] = 300;
  const auto scale = energydeck::draw_history(plot, &imported, &exported, 0x3AA7D8, 0x48BD70, .25, true);
  assert(scale == 1 && lv_obj_get_child_count(plot) == 48);
  assert(!lv_obj_has_flag(lv_obj_get_child(plot, 0), LV_OBJ_FLAG_HIDDEN));
  assert(!lv_obj_has_flag(lv_obj_get_child(plot, 1), LV_OBJ_FLAG_HIDDEN));
  assert(!lv_obj_has_flag(lv_obj_get_child(plot, 2), LV_OBJ_FLAG_HIDDEN)); // Known zero.
  assert(lv_obj_has_flag(lv_obj_get_child(plot, 4), LV_OBJ_FLAG_HIDDEN)); // Future hour.
  energydeck::draw_history(plot, &imported, nullptr, 0x3AA7D8, 0x48BD70, .25, true);
  for (int i = 1; i < 48; i += 2) assert(lv_obj_has_flag(lv_obj_get_child(plot, i), LV_OBJ_FLAG_HIDDEN));
  energydeck::draw_history(plot, nullptr, nullptr, 0x3AA7D8, 0x48BD70, .25, true);
  for (int i = 0; i < 48; ++i) assert(lv_obj_has_flag(lv_obj_get_child(plot, i), LV_OBJ_FLAG_HIDDEN));
  std::cout << "PASS: production history bars retain paired scale, known zeros, future gaps and independent failure clearing\n";
  std::cout << "PASS: production LVGL arcs start at top, export/charge left, import/discharge right; standby, bounds, missing data and solar transitions\n";
}
