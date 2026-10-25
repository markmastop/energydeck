#include "../esphome/components/ui_performance/battery_detail.h"
#include <cassert>
#include <iostream>
int main() {
  energydeck::BatteryPlan p;
  const uint32_t epoch = 1792969140;
  assert(p.begin_forward(epoch, epoch + 600, 5, 1000, 10, 20, true, true, false, 0));
  assert(p.add_forward(epoch, epoch + 60, 1, -1000, -10, 50, 50.3, 0, 1));
  assert(p.add_forward(epoch + 60, epoch + 960, 2, 500, 50, 50.3, 47.7, .5, 0));
  const energydeck::BatteryDetailGeometry g(p);
  assert(g.x(epoch, 404) == 0 && g.x(epoch + 960, 404) == 404);
  assert(g.x(epoch + 60, 404) == 25); // Partial quarter uses elapsed time, not index spacing.
  assert(g.price_y(-10, 144) == 143 && g.price_y(50, 144) == 0);
  assert(g.power_y(-1000, 144) > g.power_y(0, 144));
  assert(g.power_y(500, 144) < g.power_y(0, 144));
  assert(g.selected(epoch + 70, epoch) == 1 && g.selected(0, epoch) == 0);
  assert(g.selected(epoch - 1, epoch) == 0);
  std::cout << "PASS: aligned UTC axes, partial quarters, negative prices, signed power and time selection\n";
}
