#pragma once
#include <cmath>
#include <cstdint>
#include <string>

namespace energydeck {
// The same validation/expiry contract as web/public/battery-plan.js.
struct BatteryPlan {
  bool known{false}, enabled{false};
  std::string day, phase;
  uint32_t updated_at{0}, received_at{0};
  float capacity{NAN}, top_up_w{NAN}, start{NAN};
  float sun_minutes{NAN}, sun_window{NAN};
  int reserve{0}, deadline{0};
  void clear() { known = false; }
  bool set(int version, const std::string &date, uint32_t updated, bool on,
           const std::string &state, float kwh, float watts, float target,
           float from, float until, float beginning, uint32_t received) {
    const bool phase_ok = state == "normal" || state == "disabled" || state == "solar-and-reserve" ||
      state == "grid-top-up" || state == "full-reserve";
    known = version == 1 && date.size() == 10 && phase_ok && std::isfinite(kwh) && kwh >= 1 && kwh <= 100 &&
      std::isfinite(watts) && watts >= 100 && watts <= 10000 && std::isfinite(target) && target == 100 &&
      std::isfinite(from) && from >= 0 && from <= 1439 && std::isfinite(until) && until > from && until <= 1439 &&
      (std::isnan(beginning) || (std::isfinite(beginning) && beginning >= from && beginning <= until));
    if (!known) return false;
    day = date; updated_at = updated; enabled = on; phase = state;
    capacity = kwh; top_up_w = watts; reserve = static_cast<int>(from);
    deadline = static_cast<int>(until); start = beginning; received_at = received;
    sun_minutes = sun_window = NAN;
    return true;
  }
  void set_sunshine(float minutes, float window) {
    if (std::isfinite(minutes) && std::isfinite(window) && window >= 15 && window <= 180 && minutes >= 0 && minutes <= window) {
      sun_minutes = minutes; sun_window = window;
    } else sun_minutes = sun_window = NAN;
  }
  bool valid(uint32_t ms, int64_t epoch, const std::string &date) const {
    return known && day == date && uint32_t(ms - received_at) <= 180000 &&
      epoch - updated_at <= 180 && int64_t(updated_at) - epoch <= 30;
  }
  int position(float minute, int width) const {
    return static_cast<int>(std::round(std::fmax(0, std::fmin(1, (minute - reserve) / (deadline - reserve))) * width));
  }
};
}  // namespace energydeck
