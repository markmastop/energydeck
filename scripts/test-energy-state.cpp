#include "../esphome/components/ui_performance/energy_state.h"
#include "../esphome/components/ui_performance/home_cards.h"
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
  assert(s.climate_status(0) == EnergyState::HEAT_UNKNOWN);
  EnergyState icons;
  assert(icons.car_icon_color(0) == EnergyState::ICON_DIM);
  icons.connected.set(1, 100); icons.car.set(0, 100);
  assert(icons.car_icon_color(100) == EnergyState::ICON_BLUE);
  assert(icons.car_icon_color(100, true) == EnergyState::ICON_BLUE);
  icons.charger_ready.set(1, 100);
  assert(icons.car_icon_color(100, true) == EnergyState::ICON_GREEN);
  icons.charger_ready.set(0, 100);
  assert(icons.car_icon_color(100, true) == EnergyState::ICON_BLUE);
  icons.charger_ready.set(1, 100);
  icons.car.set(1, 100); assert(icons.car_icon_color(100) == EnergyState::ICON_ORANGE);
  assert(icons.car_icon_color(100, true) == EnergyState::ICON_ORANGE);
  icons.connected.set(0, 100); assert(icons.car_icon_color(100) == EnergyState::ICON_DIM);
  icons.connected.set(1, 100); assert(icons.car_icon_color(45101) == EnergyState::ICON_DIM);
  assert(icons.heating_icon_color(100) == EnergyState::ICON_DIM);
  icons.heating_enabled.set(1, 100);
  assert(icons.heating_icon_color(100) == EnergyState::ICON_DIM); // No zone readings yet.
  for (int i = 0; i < EnergyState::ROOM_COUNT; ++i) {
    icons.room_configured[i] = true;
    icons.room_temperature[i].set(20, 100);
    icons.room_target[i].set(20, 100);
  }
  assert(icons.heating_icon_color(100) == EnergyState::ICON_GREEN);
  icons.room_target[8].set(21, 100); // The ninth zone must participate, not just the first six.
  assert(icons.room_requests_heat(8, 100) && icons.heating_icon_color(100) == EnergyState::ICON_ORANGE);
  icons.heating_enabled.set(0, 100);
  assert(!icons.room_requests_heat(8, 100) && icons.heating_icon_color(100) == EnergyState::ICON_DIM);
  icons.heating_enabled.set(1, 100);
  assert(icons.heating_icon_color(180101) == EnergyState::ICON_DIM);
  icons.room_target[8].set(20, 100); icons.room_temperature[0].set(NAN, 100);
  assert(icons.heating_icon_color(100) == EnergyState::ICON_DIM); // Missing data cannot imply idle.
  icons.room_target[8].set(23, 100);
  assert(icons.heating_icon_color(100) == EnergyState::ICON_ORANGE); // Another valid demand remains meaningful.
  icons.room_target[8].set(20, 100); icons.room_configured[0] = false;
  assert(icons.heating_icon_color(100) == EnergyState::ICON_GREEN); // Disabled slots do not count as missing.
  icons.room_target[8].set(20.001f, 100);
  assert(!icons.room_requests_heat(8, 100)); // Float noise is below Homey's 0.1 °C precision.
  icons.battery_power.set(-500, 100); icons.battery.set(45, 100);
  assert(icons.battery_icon_color(100) == EnergyState::ICON_ORANGE && icons.battery_fill_percent(100) == 45);
  icons.battery_power.set(500, 100); assert(icons.battery_icon_color(100) == EnergyState::ICON_GREEN);
  icons.battery_power.set(25, 100); assert(icons.battery_icon_color(100) == EnergyState::ICON_DIM);
  icons.battery.set(0, 100); assert(icons.battery_fill_percent(100) == 0);
  icons.battery.set(100, 100); assert(icons.battery_fill_percent(100) == 100);
  icons.battery.set(150, 100); assert(icons.battery_fill_percent(100) == 100);
  assert(icons.battery_fill_percent(45101) == 0 && icons.battery_icon_color(45101) == EnergyState::ICON_DIM);
  icons.battery.set(NAN, 100); assert(icons.battery_fill_percent(100) == 0);
  HomeCards cards;
  assert(cards.update(2, false, true, false) == 0);
  assert(cards.update(0, false, true, true) == 2);
  assert(cards.update(2, true, false, true) == 1);
  assert(cards.update(0, true, false, true) == 0); // Manual override during playback.
  assert(cards.update(1, false, false, false) == 1); // Unknown replies preserve playback.
  assert(cards.update(1, false, true, true) == 2);
  assert(cards.update(2, false, true, false) == 0);
  // The exact five-minute boundary restores the currently preferred card.
  assert(cards.update(1, false, true, false, 299999) == 1);
  assert(cards.update(1, false, true, false, 300000) == 0);
  assert(cards.update(2, false, true, false, 0) == 2); // New input resets idle time.
  assert(cards.update(2, true, false, true, 300000) == 1);
  assert(cards.update(0, false, true, true, 300000) == 2);
  std::cout << "PASS: energy direction, debounce, stale/missing values, day rollover, units, battery balance and icon colors/fill\n";
}
