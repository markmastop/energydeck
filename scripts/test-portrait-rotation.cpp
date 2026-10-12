#include "../esphome/components/ui_performance/portrait_rotation.h"
#include <array>
#include <cassert>
#include <iostream>
#include <vector>

int main() {
  constexpr int screen_width = 800, screen_height = 480;
  // Compare tiled output with the original full transpose for nonzero origins,
  // uneven source strides, partial tiles and a complete portrait framebuffer.
  for (const auto area : {std::array<int, 4>{0, 0, 480, 800}, {18, 154, 226, 40},
                          {7, 13, 1, 1}, {24, 36, 33, 67}, {1, 2, 479, 798}}) {
    const int x0 = area[0], y0 = area[1], width = area[2], height = area[3];
    assert(x0 + width <= screen_height && y0 + height <= screen_width);
    std::vector<uint16_t> input(width * height), expected(screen_width * screen_height, 0xFFFF), actual(expected);
    for (int i = 0; i < width * height; ++i) input[i] = static_cast<uint16_t>(i * 97);
    for (int y = 0; y < height; ++y)
      for (int x = 0; x < width; ++x)
        expected[(x0 + x) * screen_width + screen_width - y0 - y - 1] = input[y * width + x];
    std::array<uint16_t, 32 * 32> tile{};
    for (int y = 0; y < height; y += 32)
      for (int x = 0; x < width; x += 32) {
        const int w = std::min(32, width - x), h = std::min(32, height - y);
        esphome::ui_performance::rotate_portrait_tile(input.data() + y * width + x, width, w, h, tile.data());
        const int native_x = screen_width - y0 - y - h, native_y = x0 + x;
        for (int row = 0; row < w; ++row)
          for (int col = 0; col < h; ++col)
            actual[(native_y + row) * screen_width + native_x + col] = tile[row * h + col];
      }
    assert(actual == expected);
  }
  std::cout << "PASS: tiled portrait rotation matches the original framebuffer, including edge tiles\n";
}
