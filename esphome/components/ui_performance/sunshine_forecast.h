#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace energydeck {
// Open-Meteo sunshine_duration is seconds in the PRECEDING 15-minute interval.
// Keep UTC bounds to align with rain's five-minute bars across midnight/DST.
struct SunshineForecast {
  struct Period { uint32_t end; float seconds; };
  std::array<Period, 32> periods{};
  size_t count{0};
  uint32_t updated{0};
  void clear() { count = 0; }
  bool add(uint32_t end, float seconds) {
    if (count >= periods.size() || end < 900 || !std::isfinite(seconds) || seconds < 0 || seconds > 900 ||
        (count && int64_t(end) - periods[count - 1].end != 900)) {
      clear(); return false;
    }
    periods[count++] = {end, seconds}; return true;
  }
  float fraction(uint32_t from, uint32_t until, uint32_t now) const {
    if (!count || int64_t(now) - updated > 2700 || int64_t(updated) - now > 30 || until <= from) return NAN;
    uint32_t cursor = from;
    float sunshine = 0;
    for (size_t i = 0; i < count; ++i) {
      const auto &p = periods[i];
      const uint32_t start = p.end - 900;
      if (p.end <= cursor || start >= until) continue;
      if (start > cursor) return NAN;
      const uint32_t end = p.end < until ? p.end : until;
      sunshine += p.seconds * (end - cursor) / 900.0f;
      cursor = end;
    }
    return cursor == until ? sunshine / (until - from) : NAN;
  }
};
}  // namespace energydeck
