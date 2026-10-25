#pragma once
#include <cmath>
#include <array>
#include <cstdint>
#include <string>

namespace energydeck {
// The same validation/expiry contract as web/public/battery-plan.js.
struct BatteryPlan {
  struct ForwardInterval {
    uint32_t from, until;
    float watts, price, soc_from, soc_to, sun;
    int action, ev; // 0 hold, 1 charge, 2 discharge; EV -1 unknown, 0 stopped, 1 charging.
  };
  std::array<ForwardInterval, 145> intervals{};
  size_t interval_count{0};
  int version{1};
  uint32_t valid_until{0}, controller_updated_at{0};
  float reserve_percent{10}, end_reserve_percent{20};
  bool shadow{true}, provisional{true}, at_risk{false};
  bool known{false}, enabled{false};
  bool execution_known{false}, execution_paused{false};
  float execution_watts{0};
  std::string execution_reason;
  std::string day, phase;
  uint32_t updated_at{0}, received_at{0};
  float capacity{NAN}, top_up_w{NAN}, start{NAN};
  float sun_minutes{NAN}, sun_window{NAN};
  struct SunPeriod { float from, until, fraction; };
  std::array<SunPeriod, 16> sun_periods{};
  size_t sun_count{0};
  int reserve{0}, deadline{0};
  void clear() { known = false; execution_known = false; }
  void set_execution(const std::string &mode, const std::string &reason, float watts, uint32_t stamp, uint32_t epoch) {
    execution_known = false;
    if ((mode != "active" && mode != "paused") || !std::isfinite(watts) || watts < -2200 || watts > 1800 ||
        int64_t(epoch)-stamp > 180 || int64_t(stamp)-epoch > 30) return;
    const char *reasons[] = {"following","solar-surplus","ev-charging","ev-unknown","phase-limit","reserve","battery-unavailable",
      "stale-readings","prices-unavailable","history-unavailable","disabled","manual-mode","inputs-unavailable","site-unconfirmed","plan-unavailable"};
    for (auto *allowed : reasons) if (reason == allowed) {
      execution_known = true; execution_paused = mode == "paused"; execution_reason = reason; execution_watts = watts; return;
    }
  }
  bool begin_forward(uint32_t updated, uint32_t expiry, float kwh, float watts,
                     float minimum, float terminal, bool is_shadow, bool assumptions,
                     bool risk, uint32_t received) {
    known = false; execution_known = false; interval_count = 0; version = 2; controller_updated_at = 0;
    if (expiry <= updated || expiry - updated > 600 || !std::isfinite(kwh) || kwh < 1 || kwh > 100 ||
        !std::isfinite(watts) || watts < 0 || watts > 1000 || !std::isfinite(minimum) || minimum < 0 || minimum > 50 ||
        !std::isfinite(terminal) || terminal < minimum || terminal > 100 || (!is_shadow && assumptions)) return false;
    updated_at = updated; valid_until = expiry; capacity = kwh; top_up_w = watts;
    reserve_percent = minimum; end_reserve_percent = terminal; shadow = is_shadow;
    provisional = assumptions; at_risk = risk; received_at = received; enabled = true;
    return true;
  }
  bool add_forward(uint32_t from, uint32_t until, int action, float watts, float price,
                   float soc_from, float soc_to, float sun, int ev) {
    if (interval_count >= intervals.size() || from < updated_at || until <= from || until - from > 900 ||
        uint64_t(until) > uint64_t(updated_at) + 129600 ||
        (interval_count ? from != intervals[interval_count - 1].until : from != updated_at) ||
        action < 0 || action > 2 || !std::isfinite(watts) || watts < -2200 || watts > 1800 ||
        (action == 1 ? watts >= 0 : action == 2 ? watts <= 0 : watts != 0) ||
        ev < -1 || ev > 1 || (ev != 0 && action == 2) || !std::isfinite(price) || price < -1000 || price > 1000 ||
        !std::isfinite(soc_from) || !std::isfinite(soc_to) || soc_from < 0 || soc_from > 100 || soc_to < 0 || soc_to > 100 ||
        (!std::isnan(sun) && (!std::isfinite(sun) || sun < 0 || sun > 1))) return false;
    intervals[interval_count++] = {from, until, watts, price, soc_from, soc_to, sun, action, ev};
    return true;
  }
  int current(int64_t epoch) const {
    for (size_t i = 0; i < interval_count; i++) if (intervals[i].from <= epoch && intervals[i].until > epoch) return static_cast<int>(i);
    return -1;
  }
  int forward_position(uint32_t epoch, int width) const {
    if (!interval_count) return 0;
    const auto from = intervals[0].from, until = intervals[interval_count - 1].until;
    return static_cast<int>(std::round(std::fmax(0, std::fmin(1, (double(epoch) - from) / (until - from))) * width));
  }
  bool set(int input_version, const std::string &date, uint32_t updated, bool on,
           const std::string &state, float kwh, float watts, float target,
           float from, float until, float beginning, uint32_t received) {
    const bool phase_ok = state == "normal" || state == "disabled" || state == "solar-and-reserve" ||
      state == "grid-top-up" || state == "full-reserve";
    known = input_version == 1 && date.size() == 10 && phase_ok && std::isfinite(kwh) && kwh >= 1 && kwh <= 100 &&
      std::isfinite(watts) && watts >= 100 && watts <= 10000 && std::isfinite(target) && target == 100 &&
      std::isfinite(from) && from >= 0 && from <= 1439 && std::isfinite(until) && until > from && until <= 1439 &&
      (std::isnan(beginning) || (std::isfinite(beginning) && beginning >= from && beginning <= until));
    if (!known) return false;
    // Each refresh starts with the legacy envelope, even after a v2 proposal.
    // Reset the member before freshness checks; a shadowing argument left v2
    // selected with zero intervals and hid the plan on its second HTTP refresh.
    version = 1; execution_known = false; interval_count = 0; controller_updated_at = 0;
    day = date; updated_at = updated; enabled = on; phase = state;
    capacity = kwh; top_up_w = watts; reserve = static_cast<int>(from);
    deadline = static_cast<int>(until); start = beginning; received_at = received;
    sun_minutes = sun_window = NAN;
    sun_count = 0;
    return true;
  }
  void set_sunshine(float minutes, float window) {
    if (std::isfinite(minutes) && std::isfinite(window) && window >= 15 && window <= 180 && minutes >= 0 && minutes <= window) {
      sun_minutes = minutes; sun_window = window;
    } else sun_minutes = sun_window = NAN;
  }
  bool add_sun_period(float from, float until, float fraction) {
    if (sun_count >= sun_periods.size() || !std::isfinite(from) || !std::isfinite(until) ||
        !std::isfinite(fraction) || from < reserve || until > deadline || until <= from ||
        until - from > 15.02f || fraction < 0 || fraction > 1 ||
        (sun_count && std::fabs(from - sun_periods[sun_count - 1].until) > 0.02f)) {
      sun_count = 0; return false;
    }
    sun_periods[sun_count++] = {from, until, fraction};
    return true;
  }
  bool valid(uint32_t ms, int64_t epoch, const std::string &date) const {
    if (version == 2) return known && uint32_t(ms - received_at) <= 180000 &&
      (!controller_updated_at || (epoch - controller_updated_at <= 180 && int64_t(controller_updated_at) - epoch <= 30)) &&
      epoch >= int64_t(updated_at) - 30 && epoch - updated_at <= 600 && epoch < valid_until && current(epoch) >= 0;
    return known && day == date && uint32_t(ms - received_at) <= 180000 &&
      epoch - updated_at <= 180 && int64_t(updated_at) - epoch <= 30;
  }
  int position(float minute, int width) const {
    return static_cast<int>(std::round(std::fmax(0, std::fmin(1, (minute - reserve) / (deadline - reserve))) * width));
  }
};
}  // namespace energydeck
