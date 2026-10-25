#include "../esphome/components/ui_performance/battery_plan.h"
#include <cassert>
#include <iostream>
int main() {
  energydeck::BatteryPlan p;
  p.set_execution("active", "phase-limit", -350, 1792931400, 1792931400);
  assert(p.execution_known && !p.execution_paused && p.execution_watts == -350);
  p.set_execution("active", "untrusted-message", -350, 1792931400, 1792931400);
  assert(!p.execution_known);
  p.set_execution("paused", "ev-unknown", 0, 1792931400, 1792931581);
  assert(!p.execution_known);
  assert(p.set(1, "2026-10-25", 1792931400, true, "solar-and-reserve", 5, 1000, 100, 540, 1020, 809, 100));
  assert(p.valid(180100, 1792931580, "2026-10-25"));
  assert(!p.valid(180101, 1792931580, "2026-10-25"));
  assert(!p.valid(200, 1792931581, "2026-10-25"));
  assert(!p.valid(200, 1792931400, "2026-10-26"));
  assert(!p.valid(200, 1792931369, "2026-10-25"));
  assert(p.position(540, 268) == 0 && p.position(1020, 268) == 268);
  assert(p.position(809, 268) == 150);
  p.set_sunshine(11,180);
  assert(p.sun_minutes == 11 && p.sun_window == 180);
  assert(p.add_sun_period(795,810,0));
  assert(p.add_sun_period(810,825,1));
  assert(p.sun_count == 2 && p.sun_periods[1].fraction == 1);
  assert(!p.add_sun_period(826,840,0.5));
  assert(p.sun_count == 0 && p.known);
  assert(!p.add_sun_period(1000,1030,1));
  assert(!p.add_sun_period(810,825,2));
  p.set_sunshine(190,180);
  assert(std::isnan(p.sun_minutes) && p.known);
  assert(!p.set(1, "2026-10-25", 1792931400, true, "made-up", 5, 1000, 100, 540, 1020, 809, 100));
  assert(!p.known);
  assert(!p.set(1, "2026-10-25", 1792931400, true, "grid-top-up", 5, 1000, 100, 540, 1020, 1100, 100));
  assert(p.begin_forward(1792931400,1792932000,5,1000,10,20,true,true,false,100));
  assert(p.add_forward(1792931400,1792932300,1,-1000,10,50,54.5,0.5,1));
  assert(p.add_forward(1792932300,1792933200,2,600,50,54.5,51.34,NAN,0));
  p.known = true;
  assert(p.valid(100,1792931400,"2026-10-25"));
  assert(p.valid(180100,1792931999,"2026-10-26")); // UTC intervals do not expire at local midnight.
  assert(!p.valid(180101,1792931999,"2026-10-25"));
  assert(!p.valid(100,1792932000,"2026-10-25"));
  assert(p.forward_position(1792932300,268)==134);
  assert(p.current(1792932300)==1);
  p.controller_updated_at = 1792931400;
  assert(!p.valid(100,1792931581,"2026-10-25"));
  assert(!p.add_forward(1792933200,1792934100,2,600,50,51.34,48,NAN,1));
  assert(!p.add_forward(1792933200,1792934100,2,600,50,51.34,48,NAN,-1));
  assert(!p.add_forward(1792933201,1792934100,0,0,50,51,51,NAN,0));
  // Every HTTP refresh parses a v1 envelope before its nested v2 proposal.
  // Exercise repeated promotion, including recovery from a cleared snapshot.
  for (uint32_t refresh = 0; refresh < 5; refresh++) {
    const uint32_t epoch = 1792931400 + refresh * 60;
    if (refresh == 3) p.clear();
    assert(p.set(1, "2026-10-25", epoch, true, "grid-top-up", 5, 1000, 100, 540, 1020, 809, refresh * 60000));
    assert(p.version == 1 && p.interval_count == 0);
    assert(p.valid(refresh * 60000, epoch, "2026-10-25"));
    assert(p.begin_forward(epoch, epoch + 600, 5, 1000, 10, 20, true, true, false, refresh * 60000));
    assert(p.add_forward(epoch, epoch + 900, 1, -1000, 15, 50, 54.5, 0.5, 0));
    p.known = true;
    p.controller_updated_at = epoch;
    assert(p.version == 2 && p.valid(refresh * 60000 + 59999, epoch + 59, "2026-10-25"));
  }
  std::cout << "PASS: display plan validation, stale/manual expiry, midnight, future data and timeline geometry\n";
}
