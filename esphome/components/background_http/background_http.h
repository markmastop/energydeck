#pragma once
#include "mailbox.h"
#include "esphome/core/component.h"
#include "esphome/core/automation.h"
#include <deque>
#ifdef USE_ESP32
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#else
#include <condition_variable>
#include <mutex>
#include <thread>
#endif

namespace esphome::background_http {
class BackgroundHttp : public Component {
 public:
  using Callback = std::function<void(Reply)>;
  void setup() override;
  void loop() override;
  void dump_config() override;
  // Reserve the contiguous 16 KiB internal task stack before LVGL allocates
  // hundreds of small widgets. The worker sleeps until a request is submitted.
  float get_setup_priority() const override { return setup_priority::PROCESSOR + 10; }
  void set_timeout(uint32_t timeout) { timeout_ms_ = timeout; }
  // Priority orders unsent jobs only: controls, data, then artwork. A sent
  // request is never retried or interrupted, especially a possibly applied write.
  bool enqueue(std::function<Reply()> work, Callback done, uint8_t priority,
               std::shared_ptr<std::atomic<bool>> cancelled = {});
  bool submit(Request request, Callback done, uint8_t priority, std::shared_ptr<std::atomic<bool>> cancelled = {}) {
    request.timeout_ms = timeout_ms_;
    return enqueue([request = std::move(request), cancelled]() {
      if (cancelled && cancelled->load(std::memory_order_acquire)) return Reply{};
      return perform_http(request);
    }, std::move(done), priority, cancelled);
  }
#ifndef USE_ESP32
  ~BackgroundHttp();
#endif
 protected:
  void work_();
  struct Job {
    std::function<Reply()> work; Callback done; uint8_t priority;
    std::shared_ptr<std::atomic<bool>> cancelled;
  };
  void prune_cancelled_();
  std::deque<Job> waiting_;
  Callback done_;
  Mailbox mailbox_;
  uint32_t timeout_ms_{8000}, next_delivery_ms_{0};
#ifdef USE_ESP32
  TaskHandle_t worker_{nullptr};
#else
  std::thread worker_;
  std::mutex wake_mutex_;
  std::condition_variable wake_;
  bool notified_{false}, stopping_{false};
#endif
};

template<typename... Ts> class SendAction : public Action<Ts...> {
 public:
  explicit SendAction(BackgroundHttp *parent) : parent_(parent) {}
  TEMPLATABLE_VALUE(std::string, url)
  TEMPLATABLE_VALUE(std::string, body)
  void set_method(const char *method) { method_ = method; }
  void set_priority(uint8_t priority) { priority_ = priority; }
  void set_max_bytes(size_t size) { max_bytes_ = size; }
  void add_header(const std::string &name, TemplatableValue<std::string, Ts...> value) { headers_.emplace_back(name, value); }
  Trigger<std::shared_ptr<Reply>, std::string &, Ts...> *get_success_trigger() { return &success_; }
  Trigger<Ts...> *get_error_trigger() { return &error_; }
  void play_complex(const Ts &...args) override {
    this->num_running_++;
    const auto generation = ++generation_;
    cancelled_ = std::make_shared<std::atomic<bool>>(false);
    Request request;
    request.url = url_.value(args...); request.method = method_; request.body = body_.value(args...);
    request.max_bytes = max_bytes_;
    for (const auto &h : headers_) request.headers.push_back({h.first, h.second.value(args...)});
    auto done = [this, generation, args...](Reply reply) mutable {
      if (generation != generation_ || !this->num_running_) return; // Cancelled/restarted automation.
      if (reply.status_code == 0) error_.trigger(args...);
      else {
        auto response = std::make_shared<Reply>(std::move(reply));
        auto body = std::move(response->body);
        success_.trigger(response, body, args...);
      }
      // Keep script.wait/single-mode semantics: advance only after this reply,
      // never immediately when the request is enqueued.
      if (generation == generation_) this->play_next_(args...);
    };
    if (!parent_->submit(std::move(request), done, priority_, cancelled_)) done({});
  }
 protected:
  void play(const Ts &...) override {}
  void stop() override {
    ++generation_;
    if (cancelled_) cancelled_->store(true, std::memory_order_release);
  }
  BackgroundHttp *parent_;
  std::string method_{"GET"};
  uint8_t priority_{1};
  size_t max_bytes_{32768};
  uint32_t generation_{0};
  std::shared_ptr<std::atomic<bool>> cancelled_;
  std::vector<std::pair<std::string, TemplatableValue<std::string, Ts...>>> headers_;
  Trigger<std::shared_ptr<Reply>, std::string &, Ts...> success_;
  Trigger<Ts...> error_;
};
}  // namespace esphome::background_http
