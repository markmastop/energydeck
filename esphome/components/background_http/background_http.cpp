#include "background_http.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "esphome/components/ui_performance/ui_priority.h"
#ifdef USE_ESP32
#include "esp_heap_caps.h"
#endif

namespace esphome::background_http {
void BackgroundHttp::setup() {
#ifdef USE_ESP32
  // Keep TLS/decoding on core 0; the display loop runs on core 1. Both workers
  // stay below the foreground loop's task priority and sleep between jobs.
  if (xTaskCreatePinnedToCore([](void *arg) { static_cast<BackgroundHttp *>(arg)->work_(); }, "background_http",
                              16384, this, 1, &worker_, 0) != pdPASS) {
    ESP_LOGE("background_http", "Cannot allocate 16384 B worker stack: internal free %u/largest %u B",
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)));
    mark_failed();
    return;
  }
  ESP_LOGI("background_http", "Worker started: 16384 B stack, internal free %u/largest %u B",
    static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
    static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)));
#else
  worker_ = std::thread([this]() { work_(); });
#endif
}
void BackgroundHttp::dump_config() { ESP_LOGCONFIG("background_http", "HTTP/artwork: serialized background worker, UI-first publication, bounded replies"); }
void BackgroundHttp::prune_cancelled_() {
  // Frequent restart-mode polls must not fill the bounded queue with obsolete work.
  waiting_.erase(std::remove_if(waiting_.begin(), waiting_.end(), [](const Job &job) {
    return job.cancelled && job.cancelled->load(std::memory_order_acquire);
  }), waiting_.end());
}
bool BackgroundHttp::enqueue(std::function<Reply()> work, Callback done, uint8_t priority,
                             std::shared_ptr<std::atomic<bool>> cancelled) {
  prune_cancelled_();
  if (is_failed() || waiting_.size() >= 32) return false;
  waiting_.push_back({std::move(work), std::move(done), priority, std::move(cancelled)});
  enable_loop();
  return true;
}
void BackgroundHttp::loop() {
  const auto now = millis();
  if (mailbox_.ready()) {
    if (!ui_performance::background_allowed() || static_cast<int32_t>(now - next_delivery_ms_) < 0) return;
    auto reply = mailbox_.take();
    auto done = std::move(done_);
    const auto start = millis();
    done(std::move(reply));
    const auto duration = millis() - start;
    if (duration > 20) ESP_LOGW("ui_performance", "Data publication: %u ms", static_cast<unsigned>(duration));
    next_delivery_ms_ = millis() + 20; // Space publications so chained scripts yield to input/rendering.
  }
  if (mailbox_.busy()) return;
  prune_cancelled_();
  if (waiting_.empty()) { disable_loop(); return; }
  auto chosen = std::min_element(waiting_.begin(), waiting_.end(), [](const Job &a, const Job &b) { return a.priority < b.priority; });
  done_ = std::move(chosen->done);
  mailbox_.submit(std::move(chosen->work));
  waiting_.erase(chosen);
#ifdef USE_ESP32
  xTaskNotifyGive(worker_);
#else
  { std::lock_guard<std::mutex> lock(wake_mutex_); notified_ = true; }
  wake_.notify_one();
#endif
}
void BackgroundHttp::work_() {
  for (;;) {
#ifdef USE_ESP32
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
#else
    { std::unique_lock<std::mutex> lock(wake_mutex_);
      wake_.wait(lock, [this]() { return notified_ || stopping_; });
      if (stopping_) return;
      notified_ = false;
    }
#endif
    mailbox_.run();
  }
}
#ifndef USE_ESP32
BackgroundHttp::~BackgroundHttp() {
  { std::lock_guard<std::mutex> lock(wake_mutex_); stopping_ = true; }
  wake_.notify_one();
  if (worker_.joinable()) worker_.join();
}
#endif
}  // namespace esphome::background_http
