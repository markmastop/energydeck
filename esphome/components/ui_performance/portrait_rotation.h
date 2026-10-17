#pragma once
#include <cstdint>

namespace esphome::ui_performance {
// Rotate one packed RGB565 tile clockwise. Preserve the two bytes of each
// pixel; the existing RGB driver owns the panel's byte/color conventions.
#if defined(__GNUC__) || defined(__clang__)
__attribute__((hot, always_inline))
#endif
inline void rotate_portrait_tile(const uint16_t *source, int stride, int width, int height, uint16_t *target) {
  for (int y = 0; y < height; ++y) {
    const uint16_t *src_row = source + y * stride;
    const int offset = height - y - 1;
    for (int x = 0; x < width; ++x)
      target[x * height + offset] = src_row[x];
  }
}
}  // namespace esphome::ui_performance
