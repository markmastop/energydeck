#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace energydeck {
struct HourlyHistory {
  std::array<double, 24> values{};
  std::array<unsigned, 24> seconds{};
  std::array<bool, 24> broken{};
  int date{0};
  uint32_t fetched_at{0};
  bool loaded{false};
  bool previous_valid{false};
  int64_t previous_time{0};
  double previous_value{0};

  // Homey returns averaged cumulative meter readings every five minutes. Keep
  // double precision: subtracting large kWh/m³ counters as floats loses usage.
  void add(int64_t timestamp, double value, int interval_hour) {
    if (interval_hour < 0 || interval_hour > 23 || !std::isfinite(value) || value < 0) {
      previous_valid = false;
      return;
    }
    if (previous_valid) {
      const auto dt = timestamp - previous_time;
      const double delta = value - previous_value;
      if (dt <= 0) return;  // Duplicate/out-of-order entries cannot add usage twice.
      if (dt != 300 || delta < -0.000001) {
        // Gaps and meter resets must not become consumption spikes or zero bars.
        broken[interval_hour] = true;
      } else {
        values[interval_hour] += std::max(0.0, delta);
        seconds[interval_hour] += 300;
      }
    }
    previous_time = timestamp;
    previous_value = value;
    previous_valid = true;
  }
  void verify_coverage(const std::array<unsigned, 24> &expected) {
    for (int i = 0; i < 24; ++i) if (seconds[i] != expected[i]) broken[i] = true;
  }
  bool valid(int hour) const { return loaded && seconds[hour] > 0 && !broken[hour]; }
  bool fresh(int today, uint32_t now) const {
    return loaded && date == today && uint32_t(now - fetched_at) <= 15 * 60 * 1000;
  }
  double maximum() const {
    double result = 0;
    for (int i = 0; i < 24; ++i) if (valid(i)) result = std::max(result, values[i]);
    return result;
  }
};
struct EnergyHistory {
  HourlyHistory imported, exported, gas;
};
}  // namespace energydeck
