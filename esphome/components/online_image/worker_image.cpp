#include "worker_image.h"
#include "esphome/components/runtime_image/image_decoder.h"
#include <pngle.h>
#include "esphome/core/hal.h"
#include <JPEGDEC.h>
#ifdef USE_ESP32
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#endif

namespace esphome::online_image {
namespace {
inline void yield_worker() {
#ifdef USE_ESP32
  vTaskDelay(1); // Let Wi-Fi and the idle-task watchdog run during large decodes.
#endif
}
inline bool safe_size(int w, int h) { return w > 0 && h > 0 && w <= 4096 && h <= 4096; }
// ESPHome's standard decoder feeds the application watchdog from pixel callbacks.
// Use isolated callbacks instead: only the foreground loop owns App/feed_wdt.
class WorkerDecoder : public runtime_image::ImageDecoder {
 public:
  explicit WorkerDecoder(WorkerImage *image) : ImageDecoder(image) {}
  bool set_size(int w, int h) {
    size_valid_ = static_cast<WorkerImage *>(image_)->allocate(w, h);
    x_scale_ = static_cast<double>(image_->get_buffer_width()) / w;
    y_scale_ = static_cast<double>(image_->get_buffer_height()) / h;
    return size_valid_;
  }
};
class WorkerJpeg : public WorkerDecoder {
 public:
  explicit WorkerJpeg(WorkerImage *image) : WorkerDecoder(image) {}
  int decode(uint8_t *bytes, size_t size) override {
    if (size < 4 || bytes[size - 2] != 0xFF || bytes[size - 1] != 0xD9 || !jpeg_.openRAM(bytes, size, draw_)) return -1;
    if (jpeg_.getJPEGType() != JPEG_MODE_BASELINE || !safe_size(jpeg_.getWidth(), jpeg_.getHeight()) ||
        !set_size(jpeg_.getWidth(), jpeg_.getHeight())) { jpeg_.close(); return -1; }
    jpeg_.setUserPointer(this);
    jpeg_.setPixelType(RGB565_LITTLE_ENDIAN);
    started_ = millis();
    const bool ok = jpeg_.decode(0, 0, 0);
    jpeg_.close();
    if (!ok) return -1;
    decoded_bytes_ = size;
    return static_cast<int>(size);
  }
 private:
  static int draw_(JPEGDRAW *block) {
    auto *self = static_cast<WorkerJpeg *>(block->pUser);
    if (millis() - self->started_ >= 15000) return 0;
    size_t pos = 0;
    for (int y = 0; y < block->iHeight; ++y) for (int x = 0; x < block->iWidth; ++x) {
      // JPEGDEC's RGB8888 channel order differs between scalar and SIMD paths.
      // RGB565 has one portable channel layout on ESP32 and the ARM simulator.
      const uint16_t pixel = block->pPixels[pos++];
      const uint8_t r = (pixel >> 11) & 31, g = (pixel >> 5) & 63, b = pixel & 31;
      self->draw(block->x + x, block->y + y, 1, 1,
                 Color((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255));
    }
    if ((self->pixels_ += block->iHeight * block->iWidth) >= 4096) { self->pixels_ = 0; yield_worker(); }
    return 1;
  }
  JPEGDEC jpeg_{};
  uint32_t started_{0}, pixels_{0};
};
class WorkerPng : public WorkerDecoder {
 public:
  explicit WorkerPng(WorkerImage *image) : WorkerDecoder(image) {
    RAMAllocator<pngle_t> allocator;
    pngle_ = allocator.allocate(1, PNGLE_T_SIZE);
    if (!pngle_) return;
    memset(pngle_, 0, PNGLE_T_SIZE);
    pngle_reset(pngle_);
    pngle_set_user_data(pngle_, this);
    pngle_set_init_callback(pngle_, [](pngle_t *png, uint32_t w, uint32_t h) {
      auto *self = static_cast<WorkerPng *>(pngle_get_user_data(png));
      self->size_valid_ = safe_size(w, h) && self->set_size(w, h);
    });
    pngle_set_draw_callback(pngle_, [](pngle_t *png, uint32_t x, uint32_t y, uint32_t w, uint32_t h, const uint8_t rgba[4]) {
      auto *self = static_cast<WorkerPng *>(pngle_get_user_data(png));
      if (millis() - self->started_ >= 15000) { self->timed_out_ = true; return; }
      self->draw(x, y, w, h, Color(rgba[0], rgba[1], rgba[2], rgba[3]));
      if ((self->pixels_ += w * h) >= 4096) { self->pixels_ = 0; yield_worker(); }
    });
    pngle_set_done_callback(pngle_, [](pngle_t *png) {
      static_cast<WorkerPng *>(pngle_get_user_data(png))->finished_ = true;
    });
  }
  ~WorkerPng() override {
    if (pngle_) { pngle_reset(pngle_); RAMAllocator<pngle_t>().deallocate(pngle_, PNGLE_T_SIZE); }
  }
  int prepare(size_t size) override {
    started_ = millis();
    return pngle_ ? WorkerDecoder::prepare(size) : -1;
  }
  int decode(uint8_t *data, size_t size) override {
    const int count = pngle_feed(pngle_, data, size);
    if (count < 0 || !size_valid_ || timed_out_) return -1;
    decoded_bytes_ += count;
    return count;
  }
  bool is_finished() const override { return finished_ && size_valid_ && !timed_out_; }
 private:
  pngle_t *pngle_{nullptr};
  bool finished_{false}, timed_out_{false};
  uint32_t pixels_{0}, started_{0};
};
}  // namespace
bool WorkerImage::allocate(int w, int h) {
  if (!safe_size(w, h) || buffer_) return false;
  int width = fixed_width_ ? fixed_width_ : w, height = fixed_height_ ? fixed_height_ : h;
  if (fixed_width_ && fixed_height_) {
    const float scale = std::min(static_cast<float>(fixed_width_) / w, static_cast<float>(fixed_height_) / h);
    width = w * scale; height = h * scale;
  }
  const size_t bytes = get_buffer_size(width, height);
  if (!bytes || bytes > 512 * 1024) return false;
  buffer_ = RAMAllocator<uint8_t>().allocate(bytes);
  if (!buffer_) return false;
  memset(buffer_, 0, bytes);
  buffer_width_ = width; buffer_height_ = height;
  return true;
}
bool WorkerImage::decode_complete(std::string &bytes, bool png) {
  if (bytes.empty() || bytes.size() > 512 * 1024) return false;
  if (png) decoder_ = std::make_unique<WorkerPng>(this);
  else decoder_ = std::make_unique<WorkerJpeg>(this);
  total_size_ = bytes.size(); decoded_bytes_ = 0;
  if (decoder_->prepare(bytes.size()) < 0) { release(); return false; }
  const auto start = millis();
  size_t consumed = 0;
  while (consumed < bytes.size() && millis() - start < 15000) {
    // PNGLE may leave a partial chunk unconsumed. All compressed bytes are
    // already worker-owned, so offer the complete remaining input each time.
    const size_t chunk = bytes.size() - consumed;
    const int count = feed_data(reinterpret_cast<uint8_t *>(bytes.data()) + consumed, chunk);
    if (count <= 0) { release(); return false; }
    consumed += count;
    yield_worker();
  }
  if (consumed != bytes.size() || !is_decode_finished()) { release(); return false; }
  width_ = buffer_width_; height_ = buffer_height_; data_start_ = buffer_;
  decoder_.reset();
  return true;
}
}  // namespace esphome::online_image
