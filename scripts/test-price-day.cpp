#include "../esphome/components/ui_performance/price_day.h"
#include <cassert>
#include <iostream>
#include <string>
using energydeck::PriceDay;
using energydeck::PriceWindow;

std::string payload(int count, const char *date, int base = 0) {
  std::string result = "{\"today\":{\"date\":\"" + std::string(date) + "\",\"values\":[";
  for (int i = 0; i < count; ++i) result += (i ? "," : "") + std::to_string(base + i);
  return result + "]}}";
}
int main() {
  for (const int count : {92, 96, 100}) {
    const auto raw = payload(count, "2026-10-25", -20);
    PriceDay today;
    assert(today.parse(raw.c_str(), "\"today\"", "\"date\":\"2026-10-25\"", 1000, 1000 + count * 900));
    assert(today.count == count && today.values[count - 1] == count - 21);
    assert(today.average() == (count - 1) / 2.0f - 20);
    assert(today.quarter(1000 + 8 * 900) == 8);
    assert(today.quarter(1000 + 12 * 900) == 12); // Repeated local hours have distinct indices.
    for (const int next_count : {92, 96, 100}) {
      if (count != 96 && next_count != 96) continue; // Adjacent dates cannot both be DST transitions.
      PriceDay tomorrow;
      const auto next_raw = payload(next_count, "2026-10-26", count - 20);
      assert(tomorrow.parse(next_raw.c_str(), "\"today\"", "\"date\":\"2026-10-26\"", today.end, today.end + next_count * 900));
      for (const int q : {0, today.noon() - 1, today.noon(), count - 1}) {
        for (const bool available : {false, true}) {
          for (const bool selected : {false, true}) {
            PriceWindow w;
            w.select(today, available ? &tomorrow : nullptr, selected && available, q);
            const bool rolling = available && !selected && q >= today.noon();
            assert(w.rolling == rolling);
            assert(w.count == (selected && available ? next_count : rolling ? next_count : count));
            const int first = selected && available ? count : rolling ? today.noon() : 0;
            for (int i = 0; i < w.count; ++i) assert(w.values[i] == first + i - 20);
            if (!selected || !available) assert(w.values[q - w.offset] == today.values[q]);
            assert(w.start == (selected && available ? today.end : today.start + w.offset * 900));
            assert(w.cheapest() == 0);
            for (int i = 0; i < w.count; ++i) w.values[i] = i >= w.count - 12 ? -1 : 1;
            assert(w.cheapest() == w.count - 12); // Includes the last full three elapsed hours.
          }
        }
      }
    }
    // Reject mismatched dates, ordinary-sized DST payloads, missing or extra quarters.
    for (const int bad_count : {0, 91, 92, 95, 96, 97, 100, 101}) {
      if (bad_count == count) continue;
      PriceDay invalid;
      const auto bad = payload(bad_count, "2026-10-25");
      assert(!invalid.parse(bad.c_str(), "\"today\"", "\"date\":\"2026-10-25\"", 1000, 1000 + count * 900));
      assert(invalid.count == 0);
    }
    PriceDay invalid;
    assert(!invalid.parse(raw.c_str(), "\"today\"", "\"date\":\"2026-10-24\"", 1000, 1000 + count * 900));
    for (const auto *value : {"null", "NaN", "Infinity", "\"0.1\""}) {
      auto bad = raw;
      const auto start = bad.find('[') + 1, end = bad.find(',', start);
      bad.replace(start, end - start, value);
      assert(!invalid.parse(bad.c_str(), "\"today\"", "\"date\":\"2026-10-25\"", 1000, 1000 + count * 900));
    }
  }
  std::cout << "PASS: 92/96/100-quarter parsing, invalid/stale data, repeated hours, day averages, noon windows, current index and cheapest real three hours\n";
}
