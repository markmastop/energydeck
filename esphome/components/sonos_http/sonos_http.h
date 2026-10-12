#pragma once
#include "esphome/core/component.h"
#include "exchange.h"
#ifdef USE_ESP32
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#else
#include <condition_variable>
#include <mutex>
#include <thread>
#endif

namespace esphome::sonos_http {

class SonosHttp : public Component {
 public:
  void setup() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::LATE; }
  bool busy() const { return this->exchange_.busy(); }
  bool ready() const { return this->exchange_.ready(); }
  void submit(const energydeck_sonos::Request &request, uint32_t timeout_ms = 8000);
  Reply take() { return this->exchange_.take(); }
#ifndef USE_ESP32
  ~SonosHttp();
#endif

 protected:
  void work_();
  Reply perform_(const energydeck_sonos::Request &request, uint32_t timeout_ms);
  Exchange exchange_;
#ifdef USE_ESP32
  TaskHandle_t worker_{nullptr};
#else
  std::thread worker_;
  std::mutex wake_mutex_;
  std::condition_variable wake_;
  bool notified_{false}, stopping_{false};
#endif
};

}  // namespace esphome::sonos_http
