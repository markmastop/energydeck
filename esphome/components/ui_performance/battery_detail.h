#pragma once
#include "battery_plan.h"
#include <algorithm>

namespace energydeck {
// Shared UTC axis for prices and signed watts. Forecast values are never
// interpreted as historical measurements. Negative Sessy power means charging.
struct BatteryDetailGeometry {
  const BatteryPlan &plan;
  float low{0}, high{1};
  static constexpr float POWER_MAX = 2500;
  explicit BatteryDetailGeometry(const BatteryPlan &p) : plan(p) {
    for (size_t i = 0; i < p.interval_count; i++) {
      low = std::min(low, p.intervals[i].price); high = std::max(high, p.intervals[i].price);
    }
  }
  int x(uint32_t epoch, int width) const { return plan.forward_position(epoch, width); }
  int price_y(float price, int height) const {
    return static_cast<int>(std::round((1 - (price - low) / (high - low)) * (height - 1)));
  }
  static int power_y(float watts, int height) {
    const float clipped = std::max(-POWER_MAX, std::min(POWER_MAX, watts));
    return static_cast<int>(std::round((.5f - clipped / POWER_MAX * .5f) * (height - 1)));
  }
  static int soc_y(float percent, int height) {
    const float clipped = std::max(0.0f, std::min(100.0f, percent));
    return static_cast<int>(std::round((1 - clipped / 100) * (height - 1)));
  }
  int selected(uint32_t epoch, uint32_t now) const {
    const int index = epoch ? plan.current(epoch) : -1;
    return index >= 0 ? index : plan.current(now);
  }
};
}  // namespace energydeck
