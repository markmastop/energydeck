#include "online_image.h"
#include "esphome/components/runtime_image/image_decoder.h"
#include "esphome/core/log.h"
#include <algorithm>

static const char *const TAG = "online_image";
static const char *const ETAG_HEADER_NAME = "etag";
static const char *const IF_NONE_MATCH_HEADER_NAME = "if-none-match";
static const char *const LAST_MODIFIED_HEADER_NAME = "last-modified";
static const char *const IF_MODIFIED_SINCE_HEADER_NAME = "if-modified-since";

namespace esphome::online_image {

OnlineImage::OnlineImage(const std::string &url, int width, int height, runtime_image::ImageFormat format,
                         image::ImageType type, image::Transparency transparency, image::Image *placeholder,
                         uint32_t buffer_size, bool is_big_endian)
    : RuntimeImage(format, type, transparency, placeholder, is_big_endian, width, height),
      download_buffer_(buffer_size),
      download_buffer_initial_size_(buffer_size) {
  this->set_url(url);
}

bool OnlineImage::validate_url_(const std::string &url) {
  if (url.empty()) {
    ESP_LOGE(TAG, "URL is empty");
    return false;
  }
  if (url.length() > 2048) {
    ESP_LOGE(TAG, "URL is too long");
    return false;
  }
  if (!url.starts_with("http://") && !url.starts_with("https://")) {
    ESP_LOGE(TAG, "URL must start with http:// or https://");
    return false;
  }
  return true;
}

void OnlineImage::update() {
  if (this->is_decoding()) {
    ESP_LOGW(TAG, "Image already being updated.");
    return;
  }

  if (!this->validate_url_(this->url_)) {
    ESP_LOGE(TAG, "Invalid URL: %s", this->url_.c_str());
    this->download_error_callback_.call();
    return;
  }

  ESP_LOGD(TAG, "Updating image from %s", this->url_.c_str());

  std::vector<http_request::Header> headers;

  // Add caching headers if we have them
  if (!this->etag_.empty()) {
    headers.push_back({IF_NONE_MATCH_HEADER_NAME, this->etag_});
  }
  if (!this->last_modified_.empty()) {
    headers.push_back({IF_MODIFIED_SINCE_HEADER_NAME, this->last_modified_});
  }

  // Add Accept header based on image format
  const char *accept_mime_type;
  switch (this->get_format()) {
#ifdef USE_RUNTIME_IMAGE_BMP
    case runtime_image::BMP:
      accept_mime_type = "image/bmp,*/*;q=0.8";
      break;
#endif
#ifdef USE_RUNTIME_IMAGE_JPEG
    case runtime_image::JPEG:
      accept_mime_type = "image/jpeg,*/*;q=0.8";
      break;
#endif
#ifdef USE_RUNTIME_IMAGE_PNG
    case runtime_image::PNG:
      accept_mime_type = "image/png,*/*;q=0.8";
      break;
#endif
    default:
      accept_mime_type = "image/*,*/*;q=0.8";
      break;
  }
  headers.push_back({"Accept", accept_mime_type});

  // User headers last so they can override any of the above
  for (auto &header : this->request_headers_) {
    headers.push_back(http_request::Header{header.first, header.second.value()});
  }

  this->downloader_ = this->parent_->get(this->url_, headers, {ETAG_HEADER_NAME, LAST_MODIFIED_HEADER_NAME});

  if (this->downloader_ == nullptr) {
    ESP_LOGE(TAG, "Download failed.");
    this->end_connection_();
    this->download_error_callback_.call();
    return;
  }

  int http_code = this->downloader_->status_code;
  if (http_code == HTTP_CODE_NOT_MODIFIED) {
    // Image hasn't changed on server. Skip download.
    ESP_LOGI(TAG, "Server returned HTTP 304 (Not Modified). Download skipped.");
    this->end_connection_();
    this->download_finished_callback_.call(true);
    return;
  }
  if (http_code != HTTP_CODE_OK) {
    ESP_LOGE(TAG, "HTTP result: %d", http_code);
    this->end_connection_();
    this->download_error_callback_.call();
    return;
  }

  ESP_LOGD(TAG, "Starting download");
  size_t total_size = this->downloader_->content_length;

  // Homey serves chunked JPEGs on ESP-IDF (content_length == 0). JPEGDEC
  // needs the entire compressed file, unlike the streaming PNG decoder.
  constexpr size_t MAX_JPEG_BYTES = 512 * 1024;
  if (this->get_format() == runtime_image::JPEG) {
    const size_t required = total_size == 0 ? MAX_JPEG_BYTES : total_size;
    if (required > MAX_JPEG_BYTES || this->download_buffer_.resize(required) < required) {
      ESP_LOGE(TAG, "JPEG exceeds the 512 KiB limit or allocation failed");
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    }
  }

  // Initialize decoder with the known format
  if (!this->begin_decode(total_size)) {
    ESP_LOGE(TAG, "Failed to initialize decoder for format %d", this->get_format());
    this->end_connection_();
    this->download_error_callback_.call();
    return;
  }

  // JPEG requires the complete image in the download buffer before decoding
  if (this->get_format() == runtime_image::JPEG && total_size > this->download_buffer_.size()) {
    this->download_buffer_.resize(total_size);
  }

  ESP_LOGI(TAG, "Downloading image (Size: %zu)", total_size);
  this->start_time_ = millis();
  this->enable_loop();
}

void OnlineImage::loop() {
  if (!this->is_decoding()) {
    // Not decoding at the moment => nothing to do.
    this->disable_loop();
    return;
  }

  if (!this->downloader_) {
    ESP_LOGE(TAG, "Downloader not instantiated; cannot download");
    this->end_connection_();
    this->download_error_callback_.call();
    return;
  }

  // Check if download is complete — use decoder's format-specific completion check
  // to handle both known content-length and chunked transfer encoding
  if (this->is_decode_finished() || (this->downloader_->content_length > 0 &&
                                     this->downloader_->get_bytes_read() >= this->downloader_->content_length &&
                                     this->download_buffer_.unread() == 0)) {
    // Finalize decoding
    this->end_decode();

    ESP_LOGD(TAG, "Image fully downloaded, %zu bytes in %" PRIu32 " ms", this->downloader_->get_bytes_read(),
             millis() - this->start_time_);

    // Save caching headers
    this->etag_ = this->downloader_->get_response_header(ETAG_HEADER_NAME);
    this->last_modified_ = this->downloader_->get_response_header(LAST_MODIFIED_HEADER_NAME);

    this->download_finished_callback_.call(false);
    this->end_connection_();
    return;
  }

  // Download and decode more data
  if (this->get_format() == runtime_image::JPEG && this->downloader_->content_length == 0) {
    // Do not call feed_data on partial JPEGs: upstream treats an incomplete
    // decode as fatal. Keep each read small so LVGL gets time between chunks.
    const size_t capacity = this->download_buffer_.free_capacity();
    if (capacity == 0 || millis() - this->start_time_ > 15000) {
      ESP_LOGE(TAG, "Chunked JPEG exceeds buffer or 15 second deadline");
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    }
    const auto len = this->downloader_->read(this->download_buffer_.append(),
      std::min(capacity, this->download_buffer_initial_size_));
    if (len > 0) {
      this->download_buffer_.write(len);
      return;
    }
    if (len < 0) {
      ESP_LOGE(TAG, "Chunked JPEG read failed: %d", len);
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    }
    // ESP-IDF returns zero at EOF. Require JPEG's terminal EOI marker too;
    // a truncated response must never be handed to the decoder as complete.
    const size_t size = this->download_buffer_.unread();
    const auto *bytes = this->download_buffer_.data();
    if (size < 4 || bytes[size - 2] != 0xFF || bytes[size - 1] != 0xD9) return;
    const auto consumed = this->feed_data(this->download_buffer_.data(), size);
    if (consumed <= 0) {
      ESP_LOGE(TAG, "Complete chunked JPEG could not be decoded");
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    }
    this->download_buffer_.read(consumed);
    // The upstream JPEG decoder cannot report is_finished() when its expected
    // size was zero. EOF and successful full decode are our completion signal.
    this->end_decode();
    ESP_LOGD(TAG, "Chunked JPEG fully downloaded and decoded: %zu bytes", size);
    this->etag_ = this->downloader_->get_response_header(ETAG_HEADER_NAME);
    this->last_modified_ = this->downloader_->get_response_header(LAST_MODIFIED_HEADER_NAME);
    this->download_finished_callback_.call(false);
    this->end_connection_();
    return;
  }

  size_t available = this->download_buffer_.free_capacity();
  if (available > 0) {
    // Download in chunks to avoid blocking
    available = std::min(available, this->download_buffer_initial_size_);
    auto len = this->downloader_->read(this->download_buffer_.append(), available);

    if (len > 0) {
      this->download_buffer_.write(len);

      // Feed data to decoder
      auto consumed = this->feed_data(this->download_buffer_.data(), this->download_buffer_.unread());

      if (consumed < 0) {
        ESP_LOGE(TAG, "Error decoding image: %s", esphome::runtime_image::decode_error_to_string(consumed));
        this->end_connection_();
        this->download_error_callback_.call();
        return;
      }

      if (consumed > 0) {
        this->download_buffer_.read(consumed);
      }
    } else if (len < 0) {
      ESP_LOGE(TAG, "Error downloading image: %d", len);
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    }
  } else {
    // Buffer is full, need to decode some data first
    auto consumed = this->feed_data(this->download_buffer_.data(), this->download_buffer_.unread());
    if (consumed > 0) {
      this->download_buffer_.read(consumed);
    } else if (consumed < 0) {
      ESP_LOGE(TAG, "Decode error with full buffer: %d", consumed);
      this->end_connection_();
      this->download_error_callback_.call();
      return;
    } else {
      // Decoder can't process more data, might need complete image
      // This is normal for JPEG which needs complete data
      ESP_LOGV(TAG, "Decoder waiting for more data");
    }
  }
}

void OnlineImage::end_connection_() {
  // Abort any in-progress decode to free decoder resources.
  // Use RuntimeImage::release() directly to avoid recursion with OnlineImage::release().
  if (this->is_decoding()) {
    RuntimeImage::release();
  }
  if (this->downloader_) {
    this->downloader_->end();
    this->downloader_ = nullptr;
  }
  this->download_buffer_.reset();
  this->disable_loop();
}

void OnlineImage::release() {
  // Clear cache headers
  this->etag_ = "";
  this->last_modified_ = "";

  // End any active connection
  this->end_connection_();

  // Call parent's release to free the image buffer
  RuntimeImage::release();
}

}  // namespace esphome::online_image
