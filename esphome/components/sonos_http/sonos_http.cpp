#include "sonos_http.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#ifdef USE_ESP32
#include "esp_http_client.h"
#include "esp_heap_caps.h"
#else
// ESPHome gates its bundled HTTP library so it is compiled only in .cpp files.
#define USE_HTTP_REQUEST_HOST_H
#define CPPHTTPLIB_NO_EXCEPTIONS
#include "esphome/components/http_request/httplib.h"
#endif

namespace esphome::sonos_http {
static const char *const TAG = "sonos_http";

void SonosHttp::setup() {
#ifdef USE_ESP32
  // ESP-IDF uses bytes for task stack sizes. The worker has no LVGL, model,
  // scheduler or shared Homey HTTP state; it sleeps between single requests.
  if (xTaskCreatePinnedToCore([](void *arg) { static_cast<SonosHttp *>(arg)->work_(); }, "sonos_http", 8192,
                  this, 1, &this->worker_, 0) != pdPASS) this->mark_failed();
#else
  this->worker_ = std::thread([this]() { this->work_(); });
#endif
}

void SonosHttp::dump_config() { ESP_LOGCONFIG(TAG, "Sonos SOAP: background worker, 8s controls/30s favorite loads, 64 KiB response limit"); }

void SonosHttp::submit(const energydeck_sonos::Request &request, uint32_t timeout_ms) {
  if (!this->exchange_.submit(request, std::clamp(timeout_ms, uint32_t(100), uint32_t(30000)))) return;
  if (this->is_failed() || energydeck_sonos::origin(request.host) != request.host || request.host.empty()) {
    this->exchange_.complete({});
    return;
  }
#ifdef USE_ESP32
  xTaskNotifyGive(this->worker_);
#else
  {
    std::lock_guard<std::mutex> lock(this->wake_mutex_);
    this->notified_ = true;
  }
  this->wake_.notify_one();
#endif
}

#ifndef USE_ESP32
SonosHttp::~SonosHttp() {
  {
    std::lock_guard<std::mutex> lock(this->wake_mutex_);
    this->stopping_ = true;
  }
  this->wake_.notify_one();
  if (this->worker_.joinable()) this->worker_.join();
}
#endif

void SonosHttp::work_() {
  for (;;) {
#ifdef USE_ESP32
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
#else
    {
      std::unique_lock<std::mutex> lock(this->wake_mutex_);
      this->wake_.wait(lock, [this]() { return this->notified_ || this->stopping_; });
      if (this->stopping_) return;
      this->notified_ = false;
    }
#endif
    if (const auto *request = this->exchange_.start())
      this->exchange_.complete(this->perform_(*request, this->exchange_.timeout_ms()));
  }
}

Reply SonosHttp::perform_(const energydeck_sonos::Request &request, uint32_t timeout_ms) {
  Reply reply;
  const uint32_t start = millis();
  const std::string url = request.url(), body = request.body(), soap = request.soap_action();
  const char *phase = "connect";
  size_t sent = 0;
#ifdef USE_ESP32
  esp_http_client_config_t config{};
  config.url = url.c_str();
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = timeout_ms;
  config.disable_auto_redirect = true;
  config.buffer_size = 1024;
  config.buffer_size_tx = 1024;
  auto *client = esp_http_client_init(&config);
  if (client != nullptr) {
    // Each operation shares one wall-clock deadline. Streaming/chunked replies
    // cannot stretch it indefinitely. No redirects, credentials or write retries.
    auto within_deadline = [&]() {
      const uint32_t elapsed = millis() - start;
      if (elapsed >= timeout_ms) return false;
      esp_http_client_set_timeout_ms(client, timeout_ms - elapsed);
      return true;
    };
    esp_http_client_set_header(client, "Content-Type", "text/xml; charset=\"utf-8\"");
    esp_http_client_set_header(client, "SOAPAction", soap.c_str());
    esp_http_client_set_header(client, "Connection", "close");
    bool ok = within_deadline() && esp_http_client_open(client, body.size()) == ESP_OK;
    if (ok) phase = "send";
    while (ok && sent < body.size()) {
      if (!within_deadline()) { ok = false; break; }
      const int count = esp_http_client_write(client, body.data() + sent, body.size() - sent);
      if (count <= 0) { ok = false; break; }
      sent += count;
    }
    if (ok && within_deadline()) {
      phase = "headers";
      const int64_t length = esp_http_client_fetch_headers(client);
      ok = length >= 0 && length <= Reply::MAX_BODY;
    } else ok = false;
    if (ok) phase = "body";
    char chunk[1024];
    // fetch_headers may already buffer a complete small response. Drain those
    // bytes before using the completion flag, including cached final chunks.
    while (ok) {
      if (!within_deadline()) { ok = false; break; }
      const int count = esp_http_client_read(client, chunk, sizeof(chunk));
      if (count < 0 || (count > 0 && !reply.append(chunk, count))) { ok = false; break; }
      if (count == 0) {
        if (esp_http_client_is_complete_data_received(client)) break;
        vTaskDelay(1);
      }
    }
    if (ok && millis() - start < timeout_ms) reply.status = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
  }
#else
  httplib::Client client(request.host);
  client.set_follow_location(false);
  client.set_connection_timeout(timeout_ms / 1000, (timeout_ms % 1000) * 1000);
  client.set_read_timeout(timeout_ms / 1000, (timeout_ms % 1000) * 1000);
  client.set_write_timeout(timeout_ms / 1000, (timeout_ms % 1000) * 1000);
  httplib::Request message;
  message.method = "POST";
  message.path = url.substr(request.host.size());
  message.body = body;
  message.headers = {{"Content-Type", "text/xml; charset=\"utf-8\""}, {"SOAPAction", soap}};
  message.response_handler = [&](const httplib::Response &response) {
    phase = "body";
    return response.get_header_value_u64("Content-Length") <= Reply::MAX_BODY && millis() - start < timeout_ms;
  };
  message.content_receiver = [&](const char *data, size_t size, uint64_t, uint64_t) {
    return millis() - start < timeout_ms && reply.append(data, size);
  };
  phase = "request";
  auto result = client.send(message);
  if (result) sent = body.size();
  if (result && millis() - start < timeout_ms) reply.status = result->status;
#endif
  reply.duration_ms = millis() - start;
  if (reply.status == 0) {
    // Report transport stages and sizes, never URLs, SOAP bodies or credentials.
    ESP_LOGW(TAG, "%s failed during %s: %u ms, sent %u/%u bytes, received %u bytes",
      request.action.c_str(), phase, static_cast<unsigned>(reply.duration_ms),
      static_cast<unsigned>(sent), static_cast<unsigned>(body.size()), static_cast<unsigned>(reply.body.size()));
#ifdef USE_ESP32
    ESP_LOGW(TAG, "Internal heap: free %u bytes, largest block %u bytes",
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)));
#endif
    reply.body.clear(); // Never parse an incomplete/truncated successful response.
  }
  return reply;
}

}  // namespace esphome::sonos_http
