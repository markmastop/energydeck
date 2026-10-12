#pragma once
#include "../sonos_local/sonos_local.h"
#include <atomic>
#include <cstdint>
#include <utility>

namespace esphome::sonos_http {

struct Reply {
  int status{0};
  uint32_t duration_ms{0};
  std::string body;
  static constexpr size_t MAX_BODY = 65536;
  bool append(const char *data, size_t size) {
    if (size > MAX_BODY - this->body.size()) return false;
    this->body.append(data, size);
    return true;
  }
};

// One immutable request crosses to the worker; one reply crosses back. Release /
// acquire ordering keeps strings out of races without locking the display loop.
// DONE remains occupied until the owning YAML script consumes its reply, so a
// favorites Browse cannot steal a playback/status response (or vice versa).
class Exchange {
 public:
  bool busy() const { return this->phase_.load(std::memory_order_acquire) != IDLE; }
  bool ready() const { return this->phase_.load(std::memory_order_acquire) == DONE; }
  bool submit(const energydeck_sonos::Request &request, uint32_t timeout_ms = 8000) {
    if (this->busy()) return false;
    this->request_ = request;
    this->timeout_ms_ = timeout_ms;
    this->phase_.store(QUEUED, std::memory_order_release);
    return true;
  }
  uint32_t timeout_ms() const { return this->timeout_ms_; }  // Worker only, after start().
  // Worker only; called after its notification. The main thread never changes
  // this snapshot while QUEUED/RUNNING/DONE, including when room selection changes.
  const energydeck_sonos::Request *start() {
    if (this->phase_.load(std::memory_order_acquire) != QUEUED) return nullptr;
    this->phase_.store(RUNNING, std::memory_order_release);
    return &this->request_;
  }
  void complete(Reply reply) {
    this->reply_ = std::move(reply);
    this->phase_.store(DONE, std::memory_order_release);
  }
  Reply take() {
    if (!this->ready()) return {};
    Reply result = std::move(this->reply_);
    this->phase_.store(IDLE, std::memory_order_release);
    return result;
  }

 protected:
  enum Phase : uint8_t { IDLE, QUEUED, RUNNING, DONE };
  std::atomic<Phase> phase_{IDLE};
  energydeck_sonos::Request request_;
  Reply reply_;
  uint32_t timeout_ms_{8000};
};

}  // namespace esphome::sonos_http
