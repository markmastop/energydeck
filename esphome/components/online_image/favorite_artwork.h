#pragma once
#ifdef USE_LVGL
#include <algorithm>
#include <array>
#include <map>
#include <set>
#include <string>
#include <vector>
#include "esphome/components/image/image.h"
#include "src/misc/cache/instance/lv_image_cache.h"

namespace esphome::online_image {
// Stable map nodes own thumbnails independently of the reusable download buffer.
// At most 100 playable favorites: 200 KiB pixel storage, allocated lazily.
class FavoriteArtwork {
 public:
  struct Entry { std::array<uint8_t, 32 * 32 * 2> pixels; lv_image_dsc_t descriptor{}; };
  std::string requested;
  bool busy = false;
  bool attempted(const std::string &url) const { return attempted_.count(url) != 0; }
  void begin(const std::string &url) { requested = url; busy = true; attempted_.insert(url); }
  const lv_image_dsc_t *get(const std::string &url) const {
    auto it = entries_.find(url);
    return it == entries_.end() ? nullptr : &it->second.descriptor;
  }
  void clear() {
    // Caller deletes widgets first. An in-flight result owns no widget pointers.
    for (auto &item : entries_) lv_image_cache_drop(&item.second.descriptor);
    entries_.clear(); attempted_.clear();
    if (busy) attempted_.insert(requested);
  }
  void retain(const std::vector<std::string> &urls) {
    // Widgets have been deleted before pruning; surviving images keep their
    // stable addresses. Retry failed downloads once per list refresh.
    std::set<std::string> keep(urls.begin(), urls.end());
    for (auto it = entries_.begin(); it != entries_.end();) {
      if (!keep.count(it->first)) {
        lv_image_cache_drop(&it->second.descriptor);
        it = entries_.erase(it);
      } else ++it;
    }
    retry_failed();
  }
  void retry_failed() {
    attempted_.clear();
    for (const auto &item : entries_) attempted_.insert(item.first);
    if (busy) attempted_.insert(requested);
  }
  void store(const lv_image_dsc_t *source) {
    if (!source || !source->data || !source->header.w || !source->header.h || entries_.size() >= 100) return;
    auto &entry = entries_[requested];
    lv_image_cache_drop(&entry.descriptor);
    const int w = source->header.w, h = source->header.h, side = std::min(w, h);
    for (int y = 0; y < 32; ++y) for (int x = 0; x < 32; ++x) {
      const auto *pixel = source->data + ((h - side) / 2 + y * side / 32) * source->header.stride +
                          ((w - side) / 2 + x * side / 32) * 2;
      entry.pixels[(y * 32 + x) * 2] = pixel[0];
      entry.pixels[(y * 32 + x) * 2 + 1] = pixel[1];
    }
    entry.descriptor = *source;
    entry.descriptor.header.w = entry.descriptor.header.h = 32;
    entry.descriptor.header.stride = 64;
    entry.descriptor.data_size = entry.pixels.size();
    entry.descriptor.data = entry.pixels.data();
  }
 private:
  std::map<std::string, Entry> entries_;
  std::set<std::string> attempted_;
};
}  // namespace esphome::online_image
#endif
