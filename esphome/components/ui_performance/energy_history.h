#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>

namespace energydeck {
struct HistorySample { int64_t timestamp{0}; float value{0}; };
struct LineHistory {
  // A 25-hour DST day has at most 301 five-minute samples including midnight.
  std::array<HistorySample, 310> samples{};
  unsigned count{0};
  int date{0};
  int64_t day_start{0}, day_end{0};
  uint32_t fetched_at{0};
  bool loaded{false};
  // Keep the sample buffer in persistent storage; clearing only its metadata
  // avoids large stack temporaries on the ESP32 display task.
  void clear() { count = 0; date = 0; day_start = day_end = 0; fetched_at = 0; loaded = false; }
  void add(int64_t timestamp, float value, bool signed_power) {
    if (!std::isfinite(value) || (!signed_power && value < 0) ||
        timestamp < day_start || timestamp >= day_end || count >= samples.size() ||
        (count && timestamp <= samples[count - 1].timestamp)) return;
    samples[count++] = {timestamp, value};
  }
  int64_t latest() const { return count ? samples[count - 1].timestamp : 0; }
  // Past measurements remain true when collection is delayed. Freshness only
  // controls live joins; the calendar boundary controls historical visibility.
  bool available(int today, int64_t epoch) const {
    return loaded && count && date == today && epoch >= day_start && epoch < day_end && epoch >= latest();
  }
  bool fresh(int today, uint32_t now, int64_t epoch) const {
    return loaded && count && date == today && uint32_t(now - fetched_at) <= 900000 &&
      epoch >= latest() && epoch - latest() <= 900;
  }
  float scale(float step) const {
    float peak = 0;
    for (unsigned i = 0; i < count; ++i) peak = std::max(peak, std::fabs(samples[i].value));
    return std::max(step, std::ceil(peak / step) * step);
  }
  // Normalized line segments keep rendering bounded and let tests verify the
  // actual geometry. Split sign changes exactly at zero to keep colors honest.
  template<typename Draw> void segments(bool signed_power, float maximum, Draw draw) const {
    if (!loaded || day_end <= day_start) return;
    auto x = [&](int64_t t) { return float(t - day_start) / float(day_end - day_start); };
    auto y = [&](float v) { return signed_power ? .5f - v / maximum * .5f : 1.f - v / maximum; };
    for (unsigned i = 1; i < count; ++i) {
      const auto &a = samples[i - 1], &b = samples[i];
      // Never bridge absent or invalid five-minute samples, including a stale
      // tail. Future hours have no samples and therefore no invented line.
      if (b.timestamp - a.timestamp != 300) continue;
      const float xa = x(a.timestamp), xb = x(b.timestamp);
      if (signed_power && ((a.value < 0 && b.value > 0) || (a.value > 0 && b.value < 0))) {
        const float zero_x = xa + (xb - xa) * a.value / (a.value - b.value);
        draw(xa, y(a.value), zero_x, .5f, a.value < 0);
        draw(zero_x, .5f, xb, y(b.value), b.value < 0);
      } else {
        draw(xa, y(a.value), xb, y(b.value), a.value < 0 || b.value < 0);
      }
    }
  }
};
struct EnergyHistory { LineHistory power, gas; };
}  // namespace energydeck
