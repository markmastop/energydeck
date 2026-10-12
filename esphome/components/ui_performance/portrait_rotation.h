#pragma once
#include <cstdint>

namespace esphome::ui_performance {
// Rotate one packed RGB565 tile clockwise. Preserve the two bytes of each
// pixel; the existing RGB driver owns the panel's byte/color conventions.
inline void rotate_portrait_tile(const uint16_t *source, int stride, int width, int height, uint16_t *target) {
  for (int y = 0; y < height; ++y)
    for (int x = 0; x < width; ++x)
      target[x * height + height - y - 1] = source[y * stride + x];
}
}  // namespace esphome::ui_performance
