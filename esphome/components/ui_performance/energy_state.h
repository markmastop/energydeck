#pragma once

#include <cmath>
#include <cstdint>

namespace energydeck {
struct Reading {
  float value{NAN};
  uint32_t at{0};
  int day{0};
  void set(float v, uint32_t now, int date = 0) {
    value = std::isfinite(v) ? v : NAN;
    at = now;
    day = date;
  }
  bool valid(uint32_t now, uint32_t ttl = 45000, int date = 0) const {
    // Unsigned subtraction also handles the millis() rollover.
    return std::isfinite(value) && uint32_t(now - at) <= ttl && (!date || day == date);
  }
};
struct StableMode {
  int value{-1}, candidate{-1};
  uint32_t since{0};
  int update(int next, uint32_t now) {
    if (value < 0) value = next;
    if (candidate != next) { candidate = next; since = now; }
    // Keep labels/units together and prevent clouds or near-zero noise flicker.
    if (uint32_t(now - since) >= 10000) value = candidate;
    return value;
  }
};
struct EnergyState {
  Reading grid, solar, battery, battery_power, gas, car, connected, heating_enabled;
  Reading electricity_day, solar_day, gas_day, gas_yesterday;
  static constexpr int ROOM_COUNT = 9;
  Reading room_temperature[ROOM_COUNT], room_target[ROOM_COUNT];
  bool room_configured[ROOM_COUNT]{};
  StableMode grid_mode, gas_mode, source_mode;
  static constexpr uint32_t SUMMARY_TTL = 1200000;
  static constexpr uint32_t CLIMATE_TTL = 180000;
  static constexpr uint32_t ICON_DIM = 0x46534B, ICON_BLUE = 0x3AA7D8;
  static constexpr uint32_t ICON_GREEN = 0x48BD70, ICON_ORANGE = 0xF29A38;
  uint32_t car_icon_color(uint32_t now) const {
    if (!connected.valid(now) || connected.value <= 0) return ICON_DIM;
    return car.valid(now) && car.value > 0 ? ICON_GREEN : ICON_BLUE;
  }
  enum HeatStatus { HEAT_UNKNOWN = -1, HEAT_OFF = 0, HEAT_IDLE = 1, HEAT_DEMAND = 2 };
  bool room_requests_heat(int room, uint32_t now) const {
    if (room < 0 || room >= ROOM_COUNT || !room_configured[room] ||
        !heating_enabled.valid(now, CLIMATE_TTL) || heating_enabled.value <= 0) return false;
    // Evohome temperatures are in °C, normally at 0.1 °C precision. This is
    // inferred room demand, not proof that the boiler burner is firing.
    return room_temperature[room].valid(now, CLIMATE_TTL) && room_target[room].valid(now, CLIMATE_TTL) &&
      room_target[room].value - room_temperature[room].value > 0.05f;
  }
  HeatStatus climate_status(uint32_t now) const {
    if (!heating_enabled.valid(now, CLIMATE_TTL)) return HEAT_UNKNOWN;
    if (heating_enabled.value <= 0) return HEAT_OFF;
    bool any_room = false, complete = true;
    for (int i = 0; i < ROOM_COUNT; ++i) {
      if (!room_configured[i]) continue;
      any_room = true;
      if (room_requests_heat(i, now)) return HEAT_DEMAND;
      if (!room_temperature[i].valid(now, CLIMATE_TTL) || !room_target[i].valid(now, CLIMATE_TTL)) complete = false;
    }
    return any_room && complete ? HEAT_IDLE : HEAT_UNKNOWN;
  }
  uint32_t heating_icon_color(uint32_t now) const {
    const auto status = climate_status(now);
    return status == HEAT_DEMAND ? ICON_ORANGE : status == HEAT_IDLE ? ICON_GREEN : ICON_DIM;
  }
  uint32_t battery_icon_color(uint32_t now) const {
    if (!battery_power.valid(now)) return ICON_DIM;
    // Sessy reports charging as negative, discharging as positive battery power.
    return battery_power.value < -25 ? ICON_BLUE : battery_power.value > 25 ? ICON_GREEN : ICON_DIM;
  }
  int battery_fill_percent(uint32_t now) const {
    if (!battery.valid(now)) return 0;
    return static_cast<int>(std::round(std::fmax(0.0f, std::fmin(100.0f, battery.value))));
  }
  int grid_view(uint32_t now) {
    if (!grid.valid(now)) { grid_mode = {}; return -1; }
    const int next = grid.value < -50 ? 1 : grid.value > 50 ? 0 : (grid_mode.value < 0 ? 0 : grid_mode.value);
    return grid_mode.update(next, now);
  }
  int gas_view(uint32_t now) {
    if (!gas.valid(now)) { gas_mode = {}; return -1; }
    return gas_mode.update(gas.value > 0.005f ? 1 : 0, now);
  }
  int source_view(uint32_t now) {
    const bool sun = solar.valid(now), storage = battery.valid(now) && battery_power.valid(now);
    if (!sun && !storage) { source_mode = {}; return -1; }
    const bool discharge = storage && battery_power.value > 50;
    const bool sunshine = sun && solar.value > 50;
    // Sessy battery power is positive on discharge, negative on charge.
    int next = storage && (discharge || !sunshine) ? 1 : 0;
    if (!storage) next = 0;
    if (!sun) next = 1;
    const int result = source_mode.update(next, now);
    // Missing data must disappear immediately, even during a mode hold.
    return result == 1 && !storage ? 0 : result == 0 && !sun ? 1 : result;
  }
  float house_power(uint32_t now) const {
    if (!grid.valid(now) || !solar.valid(now) || !battery_power.valid(now)) return NAN;
    // Grid import + solar + battery discharge = total site demand, including EV.
    // Polls are not simultaneous: suppress a negative balance instead of clamping it.
    const float sum = grid.value + solar.value + battery_power.value;
    return sum >= 0 ? sum : NAN;
  }
};
}  // namespace energydeck
