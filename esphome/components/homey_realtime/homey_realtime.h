#pragma once
#include "esphome/core/component.h"
#include "esphome/core/automation.h"
#include <atomic>
#include <string>
#include <vector>
#ifdef USE_ESP32
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#else
#include <thread>
#endif

namespace esphome::homey_realtime {
class HomeyRealtime : public Component {
 public:
  void set_address(const std::string &value) { address_ = value; while (!address_.empty() && address_.back() == '/') address_.pop_back(); }
  void set_token(const std::string &value) { token_ = value; }
  void add_device(const std::string &id, const std::string &target = "");
  void set_price_variable(const std::string &id);
  void defer(const std::string &id);
  Trigger<std::string> *get_change_trigger() { return &changed_; }
  bool connected() const { return connected_.load(std::memory_order_acquire); }
  void setup() override;
  void loop() override;
  void dump_config() override;
  void on_shutdown() override { stopping_.store(true, std::memory_order_release); }
  float get_setup_priority() const override { return setup_priority::LATE; }
#ifndef USE_ESP32
  ~HomeyRealtime();
#endif
 protected:
  void work_();
  bool pause_(uint32_t duration);
  std::string address_, token_, price_id_;
  std::vector<std::string> ids_, uris_;
  Trigger<std::string> changed_;
  std::atomic<uint32_t> pending_{0};
  std::atomic<bool> stopping_{false}, connected_{false};
  uint32_t delivered_at_{0};
  uint32_t source_at_[32]{};
  size_t cursor_{0};
  bool reported_{false};
#ifdef USE_ESP32
  TaskHandle_t worker_{nullptr};
#else
  std::thread worker_;
#endif
};
}  // namespace esphome::homey_realtime
