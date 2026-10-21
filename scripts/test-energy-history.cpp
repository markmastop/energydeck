#include "../esphome/components/ui_performance/energy_history.h"
#include <cassert>
#include <cmath>
#include <iostream>
using energydeck::LineHistory;
int main() {
  LineHistory power;
  power.day_start = 1000; power.day_end = 1000 + 86400;
  power.date = 20261021; power.loaded = true; power.fetched_at = 100;
  power.add(1000, 2, true); power.add(1300, -1, true);
  assert(power.count == 2 && power.scale(.5f) == 2);
  int segments = 0;
  power.segments(true, 2, [&](float x1, float y1, float x2, float y2, bool negative) {
    assert(x1 <= x2 && x1 >= 0 && x2 <= 1);
    if (segments++ == 0) { assert(!negative && y1 == 0 && y2 == .5f); }
    else { assert(negative && y1 == .5f && y2 == .75f); }
  });
  assert(segments == 2); // Both sides of a zero crossing keep their own color.
  power.add(1300, 99, true); power.add(1200, 99, true);
  power.add(1600, NAN, true); power.add(1900, .2f, true);
  assert(power.count == 3);
  segments = 0;
  power.segments(true, 2, [&](float, float, float, float, bool) { ++segments; });
  assert(segments == 2); // A missing five-minute point leaves a real gap.
  assert(power.fresh(20261021, 200, 1900));
  assert(!power.fresh(20261022, 200, 1900));
  assert(!power.fresh(20261021, 1000000, 1900));
  assert(!power.fresh(20261021, 200, 2801));
  assert(!power.fresh(20261021, 200, 1800));
  power.fetched_at = UINT32_MAX - 100;
  assert(power.fresh(20261021, 100, 1900));
  LineHistory gas; gas.day_start = 1000; gas.day_end = 87400; gas.loaded = true;
  gas.add(1000, 0, false); gas.add(1300, 0, false); gas.add(1600, -1, false);
  assert(gas.count == 2 && gas.scale(.1f) == .1f);
  segments = 0;
  gas.segments(false, .1f, [&](float, float y1, float, float y2, bool negative) {
    ++segments; assert(y1 == 1 && y2 == 1 && !negative);
  });
  assert(segments == 1); // A measured zero is a flat line, not a missing sample.
  // UTC elapsed positions remain monotonic on a repeated local-time hour.
  LineHistory dst; dst.day_start = 1000; dst.day_end = 91000; dst.loaded = true;
  for (int i = 0; i < 301; ++i) dst.add(1000 + 300 * i, .5f, true);
  assert(dst.count == 300); // Exclude the next day's midnight.
  float last_x = -1;
  dst.segments(true, 1, [&](float x1, float, float x2, float, bool) {
    assert(x1 >= last_x && x2 > x1); last_x = x2;
  });
  std::cout << "PASS: signed line geometry, zero crossings, gas units/zeros, missing samples, duplicate rejection, DST and expiry\n";
}
