#include "../esphome/components/online_image/progressive_jpeg.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>
using namespace esphome::online_image;
std::vector<uint8_t> read(const std::string &path) {
  std::ifstream stream(path, std::ios::binary);
  return {(std::istreambuf_iterator<char>(stream)), {}};
}
struct Pixels { int w = 0, h = 0, calls = 0; };
bool capture(const uint8_t *rgb, int w, int h, void *context) {
  auto &p = *static_cast<Pixels *>(context);
  p.w = w; p.h = h; ++p.calls;
  // Touch the entire decoded output under ASan, not merely the first scan.
  unsigned long checksum = 0;
  for (size_t i = 0; i < size_t(w) * h * 3; ++i) checksum += rgb[i];
  assert(checksum > 0);
  return true;
}
int main(int argc, char **argv) {
  assert(argc >= 2);
  const std::string dir = argv[1];
  auto baseline = read(dir + "/baseline.jpg");
  assert(jpeg_kind(baseline.data(), baseline.size()) == JpegKind::BASELINE);
  Pixels p;
  assert(!decode_progressive(baseline.data(), baseline.size(), capture, &p).ok);
  for (const auto name : {"progressive300.jpg", "progressive600.jpg", "gray.jpg"}) {
    auto data = read(dir + "/" + name);
    assert(jpeg_kind(data.data(), data.size()) == JpegKind::PROGRESSIVE);
    auto result = decode_progressive(data.data(), data.size(), capture, &p);
    assert(result.ok && result.peak_bytes <= 4 * 1024 * 1024);
    std::cout << name << " " << result.width << "x" << result.height << " peak=" << result.peak_bytes << '\n';
    for (size_t budget : {size_t(0), size_t(64), size_t(32768)}) {
      result = decode_progressive(data.data(), data.size(), capture, &p, budget);
      assert(!result.ok && result.peak_bytes <= budget);
      assert(decode_progressive(data.data(), data.size(), capture, &p).ok); // Cleanup after allocation failure.
    }
    result = decode_progressive(data.data(), data.size(), [](const uint8_t *, int, int, void *) { return false; }, nullptr);
    assert(!result.ok);
    assert(decode_progressive(data.data(), data.size(), capture, &p).ok);
    data.resize(data.size() / 2);
    assert(!decode_progressive(data.data(), data.size(), capture, &p).ok);
  }
  for (const auto name : {"wide.jpg", "too-many-pixels.jpg"}) {
    auto data = read(dir + "/" + name);
    assert(!decode_progressive(data.data(), data.size(), capture, &p).ok);
  }
  const uint8_t malformed[] = {0xff,0xd8,0xff,0xe0,0xff,0xff};
  assert(jpeg_kind(malformed, sizeof(malformed)) == JpegKind::INVALID);
  assert(!decode_progressive(nullptr, 0, capture, &p).ok);
  // Optional real-world inputs are read-only and are never required by CI.
  for (int i = 2; i < argc; ++i) {
    auto data = read(argv[i]);
    auto result = decode_progressive(data.data(), data.size(), capture, &p);
    assert(result.ok);
    std::cout << "real fixture " << result.width << "x" << result.height << " peak=" << result.peak_bytes << '\n';
  }
}
