#pragma once
#include <memory>
#include <string>

namespace esphome::homey_realtime {
// Worker-only, bounded WebSocket I/O. No ESPHome scheduler or LVGL calls.
class WebSocket {
 public:
  WebSocket();
  ~WebSocket();
  bool connect(const std::string &address);
  bool send(const std::string &packet);
  // -1: closed/error, 0: no complete text message yet, 1: complete text message.
  int receive(std::string &packet);
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
}  // namespace esphome::homey_realtime
