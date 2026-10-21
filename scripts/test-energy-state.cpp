#include "../esphome/components/ui_performance/energy_state.h"
#include <cassert>
#include <iostream>
#include <limits>
using namespace energydeck;
int main() {
  EnergyState s;
  assert(s.grid_view(0) == -1 && s.source_view(0) == -1);
  assert(!std::isfinite(s.house_power(0)));
  s.grid.set(500, 100);
  assert(s.grid_view(100) == 0);
  s.grid.set(-1000, 1000);
  assert(s.grid_view(1000) == 0 && s.grid_view(10999) == 0);
  assert(s.grid_view(11000) == 1);
  // Import/export noise in the 50 W deadband must not keep flipping direction.
  s.grid.set(15, 12000);
  assert(s.grid_view(12000) == 1);
  s.grid.set(300, 13000); s.grid_view(13000);
  s.grid.set(-300, 15000); s.grid_view(15000);
  assert(s.grid_view(24000) == 1);
  assert(s.grid_view(60001) == -1); // Expired values don't retain an active mode.
  s.gas.set(0, 100); assert(s.gas_view(100) == 0);
  s.gas.set(.8f, 1000); assert(s.gas_view(1000) == 0);
  assert(s.gas_view(11000) == 1);
  s.gas.set(NAN, 12000); assert(s.gas_view(12000) == -1);
  s.solar.set(2200, 100); s.battery.set(65, 100); s.battery_power.set(-800, 100);
  assert(s.source_view(100) == 0); // Solar has priority while battery is charging.
  s.battery_power.set(600, 1000);
  assert(s.source_view(1000) == 0 && s.source_view(11000) == 1);
  s.battery.set(NAN, 12000);
  assert(s.source_view(12000) == 0); // Stale battery cannot remain the main value.
  s.solar.set(NAN, 13000);
  assert(s.source_view(13000) == -1);
  s.battery.set(65, 14000); s.battery_power.set(0, 14000);
  assert(s.source_view(14000) == 1); // Night/standby retains a useful battery value.
  s.grid.set(500, 14000); s.solar.set(2000, 14000); s.battery_power.set(-750, 14000);
  assert(s.house_power(14000) == 1750);
  s.battery_power.set(750, 14000); assert(s.house_power(14000) == 3250);
  s.grid.set(-4000, 14000); assert(!std::isfinite(s.house_power(14000)));
  s.electricity_day.set(-2.5f, 100, 20261021);
  assert(s.electricity_day.valid(200, s.SUMMARY_TTL, 20261021));
  assert(!s.electricity_day.valid(200, s.SUMMARY_TTL, 20261022));
  assert(!s.electricity_day.valid(1200101, s.SUMMARY_TTL, 20261021));
  Reading r; r.set(1, std::numeric_limits<uint32_t>::max()-100);
  assert(r.valid(100) && !r.valid(50000));
  r.set(std::numeric_limits<float>::infinity(), 0); assert(!r.valid(0));
  assert(!s.heating.valid(0)); // Neither gas nor a setpoint is a heating signal.
  std::cout << "PASS: energy direction, debounce, stale/missing values, day rollover, units and battery balance\n";
}
