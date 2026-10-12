#pragma once
#include "http_io.h"
#include <atomic>
#include <functional>
#include <utility>

namespace esphome::background_http {
// Main-thread queue owns callbacks. Only immutable work and its result cross the
// release/acquire mailbox; the worker never executes a UI/model callback.
class Mailbox {
 public:
  bool busy() const { return phase_.load(std::memory_order_acquire) != IDLE; }
  bool ready() const { return phase_.load(std::memory_order_acquire) == DONE; }
  void submit(std::function<Reply()> work) {
    work_ = std::move(work);
    phase_.store(QUEUED, std::memory_order_release);
  }
  bool run() {
    if (phase_.load(std::memory_order_acquire) != QUEUED) return false;
    reply_ = work_();
    work_ = {};
    phase_.store(DONE, std::memory_order_release);
    return true;
  }
  Reply take() {
    Reply result = std::move(reply_);
    phase_.store(IDLE, std::memory_order_release);
    return result;
  }
 private:
  enum Phase : uint8_t { IDLE, QUEUED, DONE };
  std::atomic<Phase> phase_{IDLE};
  std::function<Reply()> work_;
  Reply reply_;
};
}  // namespace esphome::background_http
