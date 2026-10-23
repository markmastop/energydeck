#include "http_io.h"
#include "esphome/core/defines.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#ifdef USE_ESP32
#include "esp_http_client.h"
#include "esp_heap_caps.h"
#include "esp_crt_bundle.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#else
#define USE_HTTP_REQUEST_HOST_H
#define CPPHTTPLIB_NO_EXCEPTIONS
#include "esphome/components/http_request/httplib.h"
#endif
#include <algorithm>
#include <cctype>

namespace esphome::background_http {
Reply perform_http(const Request &request) {
  Reply reply;
  const auto start = millis();
  if (request.max_bytes > 512 * 1024 || request.max_bytes == 0 ||
      (request.method != "GET" && request.method != "POST")) return reply;
  // Keep URLs/headers private; logging bodies, authenticated URLs or credentials
  // from this shared transport is unnecessary for timing diagnostics.
  const auto scheme = request.url.find("://");
  if (scheme == std::string::npos || (request.url.substr(0, scheme) != "http" && request.url.substr(0, scheme) != "https")) return reply;
#ifdef USE_ESP32
  esp_http_client_config_t config{};
  config.url = request.url.c_str();
  config.method = request.method == "POST" ? HTTP_METHOD_POST : HTTP_METHOD_GET;
  config.timeout_ms = request.timeout_ms;
  config.disable_auto_redirect = true;
  config.crt_bundle_attach = esp_crt_bundle_attach; // Preserve CA and hostname verification for HTTPS.
  config.buffer_size = config.buffer_size_tx = 1024;
  config.user_data = &reply;
  config.event_handler = [](esp_http_client_event_t *event) -> esp_err_t {
    if (event->event_id == HTTP_EVENT_ON_HEADER) {
      std::string name(event->header_key);
      std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return std::tolower(c); });
      if (name == "content-type" || name == "etag" || name == "last-modified" || name == "location" || name == "x-homey-id")
        static_cast<Reply *>(event->user_data)->keep_header(std::move(name), event->header_value);
    }
    return ESP_OK;
  };
  auto *client = esp_http_client_init(&config);
  if (!client) return reply;
  auto within_deadline = [&]() {
    const auto elapsed = millis() - start;
    if (elapsed >= request.timeout_ms) return false;
    esp_http_client_set_timeout_ms(client, request.timeout_ms - elapsed);
    return true;
  };
  esp_http_client_set_header(client, "User-Agent", "EnergyDeck");
  esp_http_client_set_header(client, "Connection", "close");
  for (const auto &h : request.headers) esp_http_client_set_header(client, h.name.c_str(), h.value.c_str());
  bool ok = within_deadline() && esp_http_client_open(client, request.body.size()) == ESP_OK;
  size_t sent = 0;
  while (ok && sent < request.body.size()) {
    if (!within_deadline()) { ok = false; break; }
    const int count = esp_http_client_write(client, request.body.data() + sent, request.body.size() - sent);
    if (count <= 0) { ok = false; break; }
    sent += count;
  }
  if (ok && within_deadline()) {
    const auto length = esp_http_client_fetch_headers(client);
    ok = length >= 0 && static_cast<uint64_t>(length) <= request.max_bytes;
  } else ok = false;
  char chunk[1024];
  // Drain buffered bytes before checking completion. Chunked responses publish
  // only after the terminating chunk; a partial 200 is a transport failure.
  while (ok) {
    if (!within_deadline()) { ok = false; break; }
    const int count = esp_http_client_read(client, chunk, sizeof(chunk));
    if (count < 0 || (count > 0 && !reply.append(chunk, count, request.max_bytes))) { ok = false; break; }
    if (count == 0) {
      if (esp_http_client_is_complete_data_received(client)) break;
      vTaskDelay(1);
    }
  }
  if (ok && millis() - start < request.timeout_ms) reply.status_code = esp_http_client_get_status_code(client);
  if (reply.status_code == 0) {
    // Sample before cleanup releases TLS memory, otherwise transient DMA/RAM
    // exhaustion disappears from diagnostics. Keep authenticated URLs private.
    ESP_LOGW("background_http", "HTTP transport failed: %u ms, internal free %u/largest %u bytes, DMA free %u/largest %u bytes",
      static_cast<unsigned>(millis() - start),
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_DMA)),
      static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_DMA)));
  }
  esp_http_client_cleanup(client);
#else
  const auto path_start = request.url.find('/', scheme + 3);
  const auto origin = request.url.substr(0, path_start);
  httplib::Client client(origin);
  client.set_follow_location(false);
  const auto seconds = request.timeout_ms / 1000, micros = (request.timeout_ms % 1000) * 1000;
  client.set_connection_timeout(seconds, micros);
  client.set_read_timeout(seconds, micros);
  client.set_write_timeout(seconds, micros);
  httplib::Request message;
  message.method = request.method;
  message.path = path_start == std::string::npos ? "/" : request.url.substr(path_start);
  message.body = request.body;
  message.headers.emplace("User-Agent", "EnergyDeck");
  for (const auto &h : request.headers) message.headers.emplace(h.name, h.value);
  message.response_handler = [&](const httplib::Response &response) {
    if (response.get_header_value_u64("Content-Length") > request.max_bytes || millis() - start >= request.timeout_ms) return false;
    for (const auto *name : {"content-type", "etag", "last-modified", "location", "x-homey-id"})
      if (response.has_header(name)) reply.keep_header(name, response.get_header_value(name).c_str());
    return true;
  };
  message.content_receiver = [&](const char *data, size_t size, uint64_t, uint64_t) {
    return millis() - start < request.timeout_ms && reply.append(data, size, request.max_bytes);
  };
  auto result = client.send(message);
  if (result && millis() - start < request.timeout_ms) reply.status_code = result->status;
#endif
  if (reply.status_code == 0) { reply.body.clear(); reply.headers.clear(); }
  reply.duration_ms = millis() - start;
  return reply;
}
}  // namespace esphome::background_http
