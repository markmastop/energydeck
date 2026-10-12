#pragma once
#include "esphome/components/runtime_image/runtime_image.h"
#include <string>

namespace esphome::online_image {
// Owned solely by the network worker until its release/acquire result is handed
// back. It has no component, watchdog, scheduler, callback or LVGL references.
class WorkerImage : public runtime_image::RuntimeImage {
 public:
  using RuntimeImage::RuntimeImage;
  bool allocate(int width, int height);
  bool decode_complete(std::string &bytes, bool png);
};
}  // namespace esphome::online_image
