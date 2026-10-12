#pragma once
#include <string>

namespace energydeck_artwork {
inline constexpr const char *RADIONL_COVER = "energydeck://artwork/radionl-west-brabant-v1";

// Call only after validating the metadata URL's origin. Decode one proxy query
// layer for matching, without broad station-name/substring substitutions.
inline std::string station_cover(const std::string &url) {
  std::string decoded;
  auto hex = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < url.size(); ++i) {
    if (url[i] != '%') { decoded += url[i]; continue; }
    if (i + 2 >= url.size()) return url;
    const int high = hex(url[i + 1]), low = hex(url[i + 2]);
    if (high < 0 || low < 0) return url;
    const char c = static_cast<char>((high << 4) | low);
    if (static_cast<unsigned char>(c) <= 32 || c == 127 || c == '\\') return url;
    decoded += c; i += 2;
  }
  for (const char *file : {"logog.jpg", "logod.jpg"}) {
    const std::string resource = std::string("https://cdn-profiles.tunein.com/s106736/images/") + file;
    const auto start = decoded.find(resource);
    if (start == std::string::npos || (start != 0 && decoded[start - 1] != '=')) continue;
    const auto end = start + resource.size();
    if (end == decoded.size() || decoded[end] == '?' || decoded[end] == '&') return RADIONL_COVER;
  }
  return url;
}
}  // namespace energydeck_artwork
