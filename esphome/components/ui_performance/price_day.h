#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace energydeck {
struct PriceDay {
  std::array<float, 100> values{};
  int count{0};
  int64_t start{0}, end{0};
  int noon() const { return count - 48; }
  int quarter(int64_t epoch) const { return int((epoch - start) / 900); }
  // Read the compact v2 bridge format, bounded by the selected day's object.
  // The expected count comes from local midnights, never from the payload.
  bool parse(const char *encoded, const char *key, const char *date_key, int64_t first, int64_t last) {
    count = 0; start = first; end = last;
    const int expected = int((end - start) / 900);
    if (expected != 92 && expected != 96 && expected != 100) return false;
    const char *section = std::strstr(encoded, key);
    const char *limit = section ? std::strchr(section, '}') : nullptr;
    const char *date = section ? std::strstr(section, date_key) : nullptr;
    const char *array = section ? std::strstr(section, "\"values\":[") : nullptr;
    if (!limit || !date || date >= limit || !array || array >= limit) return false;
    const char *p = std::strchr(array, '[') + 1;
    for (int i = 0; i < expected; ++i) {
      while (*p == ' ') ++p;
      char *next = nullptr;
      const float value = std::strtof(p, &next);
      if (next == p || next >= limit || !std::isfinite(value)) return false;
      p = next;
      while (*p == ' ') ++p;
      if (*p != (i == expected - 1 ? ']' : ',')) return false;
      ++p;
      values[i] = value;
    }
    count = expected;
    return true;
  }
  float average() const {
    float sum = 0;
    for (int i = 0; i < count; ++i) sum += values[i];
    return count ? sum / count : 0;
  }
};
struct PriceWindow {
  std::array<float, 100> values{};
  int count{0}, offset{0};
  int64_t start{0};
  bool rolling{false};
  void select(const PriceDay &today, const PriceDay *tomorrow, bool selected_tomorrow, int current) {
    const auto &day = selected_tomorrow && tomorrow ? *tomorrow : today;
    rolling = !selected_tomorrow && tomorrow && current >= today.noon();
    offset = rolling ? today.noon() : 0;
    start = day.start + offset * 900;
    count = 0;
    for (int i = offset; i < day.count; ++i) values[count++] = day.values[i];
    if (rolling) for (int i = 0; i < tomorrow->noon(); ++i) values[count++] = tomorrow->values[i];
  }
  int cheapest() const {
    int best = 0;
    float lowest = INFINITY;
    // Twelve real quarters remain three elapsed hours across either DST change.
    for (int i = 0; i <= count - 12; ++i) {
      float sum = 0;
      for (int j = 0; j < 12; ++j) sum += values[i + j];
      if (sum < lowest) { lowest = sum; best = i; }
    }
    return best;
  }
};
}  // namespace energydeck
