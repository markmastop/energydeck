#include "homey_realtime.h"
#include "protocol.h"
#include "websocket.h"
#include "esphome/components/background_http/http_io.h"
#include "esphome/components/ui_performance/ui_priority.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include <algorithm>
#ifndef USE_ESP32
#include <chrono>
#include <csignal>
#endif

namespace esphome::homey_realtime {
namespace { bool configured(const std::string &id) { return !id.empty() && id != "none"; } }
void HomeyRealtime::add_device(const std::string &id, const std::string &target) {
  const auto uri = "homey:device:" + id;
  if (!configured(id) || ids_.size() >= 31 || std::find(uris_.begin(), uris_.end(), uri) != uris_.end()) return;
  ids_.push_back(target.empty() ? id : target); uris_.push_back(uri);
}
void HomeyRealtime::set_price_variable(const std::string &id) {
  if (!configured(id) || ids_.size() >= 32) return;
  price_id_ = id; ids_.push_back(id); uris_.push_back("homey:manager:logic");
}
void HomeyRealtime::defer(const std::string &id) {
  for (size_t i = 0; i < ids_.size(); i++) if (ids_[i] == id) { pending_.fetch_or(uint32_t(1) << i, std::memory_order_release); break; }
}
void HomeyRealtime::setup() {
  if (address_.empty() || token_.empty() || token_ == "none" || uris_.empty()) { disable_loop(); return; }
#ifdef USE_ESP32
  // Socket authentication and receives never run on the touch/LVGL core. The
  // bounded bitmask is the only notification crossing from worker to UI.
  if (xTaskCreatePinnedToCore([](void *arg) { static_cast<HomeyRealtime *>(arg)->work_(); vTaskDelete(nullptr); },
      "homey_realtime", 8192, this, 1, &worker_, 0) != pdPASS) {
    ESP_LOGE("homey_realtime", "Cannot allocate 8192 B worker stack");
    mark_failed();
  } else {
    ESP_LOGI("homey_realtime", "Worker started: 8192 B stack");
  }
#else
  worker_ = std::thread([this]() {
    // OpenSSL may write after the peer closes; block SIGPIPE only on this worker.
    sigset_t signals; sigemptyset(&signals); sigaddset(&signals, SIGPIPE); pthread_sigmask(SIG_BLOCK, &signals, nullptr);
    work_();
  });
#endif
}
void HomeyRealtime::dump_config() { ESP_LOGCONFIG("homey_realtime", "Direct Homey notifications: %u configured sources, read-only REST reconciliation", static_cast<unsigned>(uris_.size())); }
void HomeyRealtime::loop() {
  const bool online = connected();
  if (online != reported_) {
    reported_ = online;
    if (online) ESP_LOGI("homey_realtime", "Live connection established (%u subscriptions)", static_cast<unsigned>(uris_.size()));
    else ESP_LOGW("homey_realtime", "Live connection lost; periodic Homey reads continue");
  }
  const auto now = millis();
  if (!pending_.load(std::memory_order_acquire) || uint32_t(now - delivered_at_) < 20 || !ui_performance::background_allowed()) return;
  // Fair round-robin publication caps each source at 1 Hz. Coalesce Evohome
  // events into one climate refresh and space sources to preserve touch latency.
  auto mask = pending_.load(std::memory_order_acquire);
  for (size_t step = 0; step < ids_.size(); step++) {
    const auto i = (cursor_ + step) % ids_.size();
    if (!(mask & (uint32_t(1) << i)) || uint32_t(now - source_at_[i]) < 1000) continue;
    uint32_t group = 0;
    for (size_t j = 0; j < ids_.size(); j++) if (ids_[j] == ids_[i]) { group |= uint32_t(1) << j; source_at_[j] = now; }
    pending_.fetch_and(~group, std::memory_order_acq_rel);
    delivered_at_ = now; cursor_ = (i + 1) % ids_.size(); changed_.trigger(ids_[i]); break;
  }
}
bool HomeyRealtime::pause_(uint32_t duration) {
  for (uint32_t elapsed = 0; elapsed < duration && !stopping_.load(std::memory_order_acquire); elapsed += 100) {
#ifdef USE_ESP32
    vTaskDelay(pdMS_TO_TICKS(100));
#else
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
#endif
  }
  return !stopping_.load(std::memory_order_acquire);
}
void HomeyRealtime::work_() {
  uint32_t retry = 1000;
  if (!pause_(5000)) return; // Let boot-time Wi-Fi and display allocation settle.
  while (!stopping_.load(std::memory_order_acquire)) {
    bool was_ready = false;
    {
      background_http::Request request;
      request.url = address_ + "/api/manager/system/ping"; request.timeout_ms = 6000; request.max_bytes = 1024;
      const auto reply = background_http::perform_http(request);
      const auto homey_id = reply.header("x-homey-id");
      if (reply.status_code == 200 && !homey_id.empty() && homey_id.size() <= 128) {
        WebSocket socket;
        if (socket.connect(address_)) {
          Protocol protocol(token_, homey_id, uris_, [&](const std::string &packet) { return socket.send(packet); },
            [&](size_t i) { pending_.fetch_or(uint32_t(1) << i, std::memory_order_release); }, millis());
          protocol.set_price_id(price_id_);
          while (!stopping_.load(std::memory_order_acquire) && protocol.tick(millis())) {
            std::string packet;
            const auto result = socket.receive(packet);
            if (result < 0 || (result > 0 && !protocol.receive(packet, millis()))) break;
            was_ready |= protocol.ready(); connected_.store(protocol.ready(), std::memory_order_release);
#ifdef USE_ESP32
            vTaskDelay(1);
#endif
          }
        }
      }
    }
    connected_.store(false, std::memory_order_release);
    if (was_ready) retry = 1000;
    if (!pause_(retry)) break;
    retry = std::min<uint32_t>(retry * 2, 30000);
  }
}
#ifndef USE_ESP32
HomeyRealtime::~HomeyRealtime() { on_shutdown(); if (worker_.joinable()) worker_.join(); }
#endif
}  // namespace esphome::homey_realtime
