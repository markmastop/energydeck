#include "../esphome/components/ui_performance/sunshine_forecast.h"
#include <cassert>
#include <iostream>

int main() {
  energydeck::SunshineForecast sun;
  const uint32_t midnight = 1792972800;
  sun.updated = midnight - 150;
  assert(sun.add(midnight, 450));
  assert(sun.add(midnight + 900, 900));
  assert(sun.fraction(midnight - 300, midnight, sun.updated) == .5f);
  assert(sun.fraction(midnight - 150, midnight + 150, sun.updated) == .75f);
  assert(std::isnan(sun.fraction(midnight + 900, midnight + 1200, sun.updated)));
  assert(std::isnan(sun.fraction(midnight, midnight + 300, sun.updated + 2701)));
  assert(std::isnan(sun.fraction(midnight, midnight + 300, sun.updated - 31)));
  assert(!sun.add(midnight + 2700, 100));
  assert(sun.count == 0);
  assert(!sun.add(midnight, 901));
  assert(!sun.add(midnight, NAN));
  assert(sun.add(midnight, 0));
  assert(sun.fraction(midnight - 300, midnight, sun.updated) == 0);
  sun.clear();
  assert(std::isnan(sun.fraction(midnight - 300, midnight, sun.updated)));
  std::cout << "Sunshine forecast overlap, freshness and validation passed\n";
}
