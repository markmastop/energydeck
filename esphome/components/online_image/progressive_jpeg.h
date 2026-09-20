#pragma once
#include <cstddef>
#include <cstdint>

namespace esphome::online_image {
enum class JpegKind { INVALID, BASELINE, PROGRESSIVE };
JpegKind jpeg_kind(const uint8_t *data, size_t size);
struct ProgressiveResult {
  bool ok = false;
  int width = 0, height = 0;
  size_t peak_bytes = 0;
  const char *error = "invalid JPEG";
};
using ProgressiveSink = bool (*)(const uint8_t *, int, int, void *);
// Sink runs synchronously; the RGB buffer is freed before returning. Limits
// cover decoder allocations, not the caller's compressed/output buffers.
ProgressiveResult decode_progressive(const uint8_t *data, size_t size, ProgressiveSink sink, void *context,
                                     size_t budget = 4 * 1024 * 1024);
}  // namespace esphome::online_image
