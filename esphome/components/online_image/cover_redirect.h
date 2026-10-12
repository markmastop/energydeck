#pragma once
#include <string>

namespace esphome::online_image {
// Only the observed Sonos -> TuneIn image redirect is trusted. Do not enable
// redirects on the shared HTTP client, which also carries Homey credentials.
inline bool allowed_cover_redirect(const std::string &source, const std::string &target) {
  for (unsigned char c : target)
    if (c <= 32 || c == 127 || c == '\\') return false;
  return (source.rfind("https://sali.sonos.superhi.fi/", 0) == 0 ||
          source.rfind("https://sali.sonos.radio/", 0) == 0) &&
         target.rfind("https://cdn-profiles.tunein.com/", 0) == 0;
}
}  // namespace esphome::online_image
