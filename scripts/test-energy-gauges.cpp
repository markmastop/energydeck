#include "lvgl.h"
#include "../esphome/components/ui_performance/energy_gauges.h"
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
  std::cout << "PASS: production LVGL arcs start at top, export/charge left, import/discharge right; standby, bounds, missing data and solar transitions\n";
}
