#include "../esphome/components/ui_performance/battery_plan.h"
#include <cassert>
#include <iostream>
int main() {
  energydeck::BatteryPlan p;
  assert(p.set(1, "2026-10-25", 1792931400, true, "solar-and-reserve", 5, 1000, 100, 540, 1020, 809, 100));
  assert(p.valid(180100, 1792931580, "2026-10-25"));
  assert(!p.valid(180101, 1792931580, "2026-10-25"));
  assert(!p.valid(200, 1792931581, "2026-10-25"));
  assert(!p.valid(200, 1792931400, "2026-10-26"));
  assert(!p.valid(200, 1792931369, "2026-10-25"));
  assert(p.position(540, 268) == 0 && p.position(1020, 268) == 268);
  assert(p.position(809, 268) == 150);
  assert(!p.set(1, "2026-10-25", 1792931400, true, "made-up", 5, 1000, 100, 540, 1020, 809, 100));
  assert(!p.known);
  assert(!p.set(1, "2026-10-25", 1792931400, true, "grid-top-up", 5, 1000, 100, 540, 1020, 1100, 100));
  std::cout << "PASS: display plan validation, stale/manual expiry, midnight, future data and timeline geometry\n";
}
