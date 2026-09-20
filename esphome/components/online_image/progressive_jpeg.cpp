#include "progressive_jpeg.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#ifdef ESP_PLATFORM
#include "esp_heap_caps.h"
#endif

namespace {
struct alignas(std::max_align_t) Allocation { size_t size; };
// ESPHome invokes decoders on its main loop. Reject reentry rather than sharing
// a budget across decodes; every allocation, including RGB output, is counted.
size_t used = 0, peak = 0, limit = 0;
bool active = false;
void *bounded_malloc(size_t size) {
  if (size > limit || used > limit - size || sizeof(Allocation) > limit - used - size) return nullptr;
  const size_t total = size + sizeof(Allocation);
#ifdef ESP_PLATFORM
  // Never consume internal Wi-Fi/LVGL RAM for the progressive working set.
  constexpr size_t reserve = 384 * 1024;
  if (heap_caps_get_free_size(MALLOC_CAP_SPIRAM) < total + reserve) return nullptr;
  auto *header = static_cast<Allocation *>(heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
#else
  auto *header = static_cast<Allocation *>(std::malloc(total));
#endif
  if (!header) return nullptr;
  header->size = total;
  used += total; peak = std::max(peak, used);
  return header + 1;
}
void bounded_free(void *ptr) {
  if (!ptr) return;
  auto *header = static_cast<Allocation *>(ptr) - 1;
  used -= header->size;
#ifdef ESP_PLATFORM
  heap_caps_free(header);
#else
  std::free(header);
#endif
}
void *bounded_realloc(void *ptr, size_t size) {
  if (!ptr) return bounded_malloc(size);
  void *replacement = bounded_malloc(size);
  if (!replacement) return nullptr;
  std::memcpy(replacement, ptr, std::min(size, (static_cast<Allocation *>(ptr) - 1)->size - sizeof(Allocation)));
  bounded_free(ptr);
  return replacement;
}
}  // namespace

#define STBI_MALLOC bounded_malloc
#define STBI_REALLOC bounded_realloc
#define STBI_FREE bounded_free
#define STBI_ONLY_JPEG
#define STBI_NO_SIMD
#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_LINEAR
#define STBI_NO_THREAD_LOCALS
#define STBI_MAX_DIMENSIONS 640
#define STB_IMAGE_STATIC
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

namespace esphome::online_image {
JpegKind jpeg_kind(const uint8_t *data, size_t size) {
  if (!data || size < 4 || data[0] != 0xFF || data[1] != 0xD8) return JpegKind::INVALID;
  size_t pos = 2;
  while (pos < size) {
    if (data[pos++] != 0xFF) return JpegKind::INVALID;
    while (pos < size && data[pos] == 0xFF) ++pos;
    if (pos >= size) break;
    const uint8_t marker = data[pos++];
    if (marker == 0xDA || marker == 0xD9 || marker == 0) break;
    if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;
    if (size - pos < 2) break;
    const size_t length = (size_t(data[pos]) << 8) | data[pos + 1];
    if (length < 2 || length > size - pos) break;
    if (marker == 0xC0) return JpegKind::BASELINE;
    if (marker == 0xC2) return JpegKind::PROGRESSIVE;
    pos += length;
  }
  return JpegKind::INVALID;
}

ProgressiveResult decode_progressive(const uint8_t *data, size_t size, ProgressiveSink sink, void *context, size_t budget) {
  ProgressiveResult result;
  if (active || used) { result.error = "decoder busy"; return result; }
  if (!sink || size > 512 * 1024 || jpeg_kind(data, size) != JpegKind::PROGRESSIVE ||
      data[size - 2] != 0xFF || data[size - 1] != 0xD9) return result;
  active = true; limit = std::min(budget, size_t(4 * 1024 * 1024)); peak = 0;
  int channels = 0;
  if (!stbi_info_from_memory(data, int(size), &result.width, &result.height, &channels) ||
      result.width <= 0 || result.height <= 0 || result.width > 640 || result.height > 640 ||
      size_t(result.width) * result.height > 400000) {
    result.error = "invalid or oversized progressive JPEG";
  } else {
    auto *rgb = stbi_load_from_memory(data, int(size), &result.width, &result.height, &channels, 3);
    if (rgb) {
      result.ok = sink(rgb, result.width, result.height, context);
      result.error = result.ok ? "" : "output allocation failed";
      stbi_image_free(rgb);
    } else result.error = "progressive decode failed or memory limit reached";
  }
  result.peak_bytes = peak;
  active = false;
  return result;
}
}  // namespace esphome::online_image
