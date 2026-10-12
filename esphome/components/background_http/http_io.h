#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace esphome::background_http {
struct Header { std::string name, value; };
struct Request {
  std::string url, method{"GET"}, body;
  std::vector<Header> headers;
  size_t max_bytes{32768};
  uint32_t timeout_ms{8000};
};
struct Reply {
  int status_code{0};
  uint32_t duration_ms{0};
  std::string body;
  std::vector<Header> headers;
  void keep_header(std::string name, const char *value) {
    // Retain only small cache/type/redirect metadata, never an unbounded header set.
    if (!value || name.size() > 32 || std::char_traits<char>::length(value) > 2048) return;
    for (auto &header : headers) if (header.name == name) { header.value = value; return; }
    if (headers.size() < 4) headers.push_back({std::move(name), value});
  }
  std::string header(const std::string &name) const {
    for (const auto &h : headers) if (h.name == name) return h.value;
    return {};
  }
  bool append(const char *data, size_t size, size_t limit) {
    if (size > limit - body.size()) return false;
    body.append(data, size);
    return true;
  }
};
// Worker-only I/O: no ESPHome scheduler, component status, UI, retries or redirects.
Reply perform_http(const Request &request);
}  // namespace esphome::background_http
