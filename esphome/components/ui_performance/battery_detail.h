#pragma once
#include "battery_plan.h"
#include "energy_history.h"
#include "price_day.h"
#include <algorithm>

namespace energydeck {
// Price and strategy plots must use the same UTC viewport, including DST days.
struct BatteryStrategyWindow {
  int64_t from, until;
  bool clip(const BatteryPlan::ForwardInterval &q, int64_t &left, int64_t &right) const {
    left = std::max(from, int64_t(q.from)); right = std::min(until, int64_t(q.until));
    return until > from && right > left;
  }
  int x(int64_t epoch, int width) const {
    return static_cast<int>(std::round(double(epoch - from) / (until - from) * width));
  }
  static float soc(const BatteryPlan::ForwardInterval &q, int64_t epoch) {
    return q.soc_from + (q.soc_to - q.soc_from) * double(epoch - q.from) / (q.until - q.from);
  }
};
// Measured and proposed SoC remain separate; outages never become invented lines.
template<class Draw> void battery_soc_segments(const LineHistory *history, const BatteryPlan *plan,
                                               int64_t now, float live, Draw draw) {
  if(history) {
    for(unsigned i=1;i<history->count;i++) {
      const auto &a=history->samples[i-1], &b=history->samples[i];
      if(b.timestamp<=now && b.timestamp-a.timestamp<=900) draw(a.timestamp,a.value,b.timestamp,b.value,false);
    }
    if(history->count && std::isfinite(live)) {
      const auto &last=history->samples[history->count-1];
      if(now>last.timestamp && now-last.timestamp<=900) draw(last.timestamp,last.value,now,live,false);
    }
  }
  if(!plan) return;
  bool first=true;
  for(size_t i=0;i<plan->interval_count;i++) {
    const auto &q=plan->intervals[i];
    if(q.until<=now) continue;
    const int64_t a=std::max(int64_t(q.from),now);
    const float value=first && a==now && std::isfinite(live)?live:BatteryStrategyWindow::soc(q,a);
    draw(a,value,q.until,q.soc_to,true);first=false;
  }
}
// Shared UTC axis for prices and signed watts. Forecast values are never
// interpreted as historical measurements. Negative Sessy power means charging.
struct BatteryDetailGeometry {
  const BatteryPlan &plan;
  uint32_t from{0}, until{0};
  float low{0}, high{1}, color_low{INFINITY}, color_high{-INFINITY};
  static constexpr float POWER_MAX = 2500;
  explicit BatteryDetailGeometry(const BatteryPlan &p, uint32_t start = 0, const PriceDay *past = nullptr) : plan(p) {
    from=start ? start : p.intervals[0].from; until=p.intervals[p.interval_count-1].until;
    if(past && past->count && past->start<from) from=past->start;
    for (size_t i = 0; i < p.interval_count; i++) {
      const float price=p.intervals[i].price;
      low=std::min(low,price); high=std::max(high,price);
      color_low=std::min(color_low,price); color_high=std::max(color_high,price);
    }
    for (int i=0; past && i<past->count; ++i) {
      const auto at=past->start+i*900;
      if (at+900>from && at<p.intervals[0].from) {
        const float price=past->values[i];
        low=std::min(low,price); high=std::max(high,price);
        color_low=std::min(color_low,price); color_high=std::max(color_high,price);
      }
    }
  }
  // Slider and cursor share elapsed UTC time, including history and DST hours.
  uint32_t selection(uint32_t epoch, uint32_t now) const {
    return std::max(from, std::min(until - 1, epoch ? epoch : now));
  }
  static float measured_soc(const LineHistory *history, uint32_t at) {
    if (!history) return NAN;
    for (unsigned i=0; i<history->count; ++i) {
      const auto &s=history->samples[i];
      if (s.timestamp == at) return s.value;
      if (i && s.timestamp > at) {
        const auto &a=history->samples[i-1];
        if (a.timestamp<=at && s.timestamp-a.timestamp<=900)
          return a.value+(s.value-a.value)*double(at-a.timestamp)/(s.timestamp-a.timestamp);
      }
    }
    return NAN;
  }
  float price_at(uint32_t at, const PriceDay *past) const {
    const int i=plan.current(at);
    if(i>=0) return plan.intervals[i].price;
    if (past && at>=past->start && at<past->end && past->quarter(at)<past->count)
      return past->values[past->quarter(at)];
    return NAN;
  }
  int x(uint32_t epoch, int width) const { return until>from ? int(std::round(double(int64_t(epoch)-from)/(until-from)*width)) : 0; }
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
