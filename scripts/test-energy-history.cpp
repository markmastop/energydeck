#include "../esphome/components/ui_performance/energy_history.h"
#include <cassert>
#include <cmath>
#include <iostream>
using energydeck::HourlyHistory;
int main() {
  HourlyHistory h;
  h.add(0, 40692.693633333336, 23);
  for (int i = 1; i <= 12; ++i) h.add(i * 300, 40692.693633333336 + i * .0123, 0);
  h.loaded = true; h.date = 20261021; h.fetched_at = 1000;
  assert(h.valid(0) && !h.valid(1));
  assert(std::abs(h.values[0] - .1476) < 1e-8);
  assert(h.seconds[0] == 3600);
  h.add(3600, 50000, 0); h.add(3300, 50000, 0);
  assert(std::abs(h.values[0] - .1476) < 1e-8);
  h.add(3900, h.previous_value, 1);
  assert(h.valid(1) && h.values[1] == 0);  // Known zero differs from absent data.
  h.add(4500, h.previous_value + .1, 1);
  assert(!h.valid(1));  // Missing five-minute interval, no invented spike.
  h.add(4800, 1, 1); assert(!h.valid(1));  // Counter reset.
  assert(h.fresh(20261021, 2000));
  assert(!h.fresh(20261022, 2000));
  assert(!h.fresh(20261021, 1000000));
  HourlyHistory wrap; wrap.loaded = true; wrap.date = 1; wrap.fetched_at = UINT32_MAX - 100;
  assert(wrap.fresh(1, 100));
  HourlyHistory gas;
  gas.add(0, 11787.183000000006, 23); gas.add(300, 11787.18399999999, 0);
  gas.loaded = true; assert(std::abs(gas.values[0] - .001) < 1e-8);
  gas.add(600, NAN, 0); gas.add(900, 11787.2, 0);
  assert(gas.seconds[0] == 300);  // Never bridge invalid/missing readings.
  std::array<unsigned, 24> coverage{}; coverage[0] = 900;
  gas.verify_coverage(coverage); assert(!gas.valid(0));
  // DST's repeated local hour accumulates both sets of UTC intervals.
  HourlyHistory dst;
  for (int i = 0; i <= 24; ++i) dst.add(i * 300, 100 + i * .01, 2);
  dst.loaded = true; assert(dst.seconds[2] == 7200 && std::abs(dst.values[2] - .24) < 1e-8);
  std::cout << "PASS: hourly meter deltas, precision, zeros, gaps, resets, duplicates, DST, day rollover and expiry\n";
}
