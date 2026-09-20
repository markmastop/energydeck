#pragma once
#include <string>

namespace esphome::online_image {
inline std::string compatible_cover_url(const std::string &url) {
  // Legacy smaller-image mapping. RADIONL is now filtered before downloading:
  // either size may be served as unsupported progressive JPEG.
  const std::string large = "https://cdn-profiles.tunein.com/s106736/images/logog.jpg";
  if (url == large || url.rfind(large + "?", 0) == 0)
    return "https://cdn-profiles.tunein.com/s106736/images/logod.jpg";
  return url;
}
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
