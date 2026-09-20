#pragma once
#include "progressive_jpeg.h"
#include "esphome/components/runtime_image/jpeg_decoder.h"
#include "esphome/core/application.h"
#include "esphome/core/log.h"

namespace esphome::online_image {
class FallbackJpegDecoder : public runtime_image::JpegDecoder {
 public:
  using JpegDecoder::JpegDecoder;
  int decode(uint8_t *buffer, size_t size) override {
    if (expected_size_ && size < expected_size_) return 0;
    if (jpeg_kind(buffer, size) != JpegKind::PROGRESSIVE)
      return JpegDecoder::decode(buffer, size);
    App.feed_wdt();
    const auto result = decode_progressive(buffer, size, [](const uint8_t *rgb, int w, int h, void *context) {
      auto *self = static_cast<FallbackJpegDecoder *>(context);
      if (!self->set_size(w, h)) return false;
      const int ow = self->image_->get_buffer_width(), oh = self->image_->get_buffer_height();
      // Copy only output pixels: a 32px thumbnail does not need 360k draw calls.
      for (int y = 0; y < oh; ++y) {
        App.feed_wdt();
        for (int x = 0; x < ow; ++x) {
          const auto *p = rgb + (size_t(y * h / oh) * w + x * w / ow) * 3;
          self->image_->draw_pixel(x, y, Color(p[0], p[1], p[2]));
        }
      }
      return true;
    }, this);
    App.feed_wdt();
    if (!result.ok) {
      ESP_LOGW("online_image", "Progressive fallback: %s", result.error);
      return runtime_image::DECODE_ERROR_INTERNAL_DECODER_ERROR;
    }
    ESP_LOGD("online_image", "Progressive JPEG decoded: %dx%d, peak %zu bytes", result.width, result.height, result.peak_bytes);
    decoded_bytes_ = size;
    return int(size);
  }
};
}  // namespace esphome::online_image
