#pragma once
#include <cstddef>
#include <string>

namespace energydeck_artwork {
inline constexpr const char *RADIONL_COVER = "energydeck://artwork/radionl-west-brabant-v1";
struct StationArtwork { const char *cover; const char *tunein_id; };
inline constexpr StationArtwork STATIONS[] = {
  {"energydeck://artwork/qmusic-v1", "s87683"},
  {"energydeck://artwork/npo-radio-2-v1", "s9483"},
  {"energydeck://artwork/npo-radio-5-v1", "s25544"},
  {"energydeck://artwork/npo-radio-1-v1", "s17523"},
  {"energydeck://artwork/radio-538-v1", "s6712"},
  {"energydeck://artwork/sky-radio-v1", "s9067"},
  {"energydeck://artwork/radio-10-v1", "s16793"},
  {"energydeck://artwork/joe-v1", "s307829"},
  {"energydeck://artwork/radio-veronica-v1", "s6717"},
  {"energydeck://artwork/100-nl-v1", "s76590"},
  {RADIONL_COVER, "s106736"},
};
inline constexpr size_t STATION_COUNT = sizeof(STATIONS) / sizeof(STATIONS[0]);
inline size_t station_index(const std::string &cover) {
  for (size_t i = 0; i < STATION_COUNT; ++i) if (cover == STATIONS[i].cover) return i;
  return STATION_COUNT;
}

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
  // Match complete TuneIn resources, including legacy HTTP URLs embedded in
  // trusted Sonos metadata. These become local assets, never HTTP downloads.
  auto match_resource = [](const std::string &resource) -> const char * {
    for (const char *prefix : {"https://cdn-profiles.tunein.com/", "http://cdn-profiles.tunein.com/",
                              "https://cdn-radiotime-logos.tunein.com/", "http://cdn-radiotime-logos.tunein.com/"}) {
      const std::string origin(prefix);
      if (resource.compare(0, origin.size(), origin) != 0) continue;
      const auto path = resource.substr(origin.size());
      const bool profiles = origin.find("cdn-profiles.") != std::string::npos;
      const auto boundary = profiles ? path.find("/images/logo") : path.find('.');
      if (boundary == std::string::npos || boundary == 0) continue;
      const auto id = path.substr(0, profiles ? boundary : boundary - 1);
      const auto file = path.substr(profiles ? boundary + 12 : boundary - 1);
      if (file.size() != 5 || (file[0] != 'g' && file[0] != 'd' && file[0] != 'q') ||
          (file.substr(1) != ".jpg" && file.substr(1) != ".png")) continue;
      for (const auto &station : STATIONS) if (id == station.tunein_id) return station.cover;
    }
    return nullptr;
  };
  for (size_t start = 0; start < decoded.size();) {
    const auto end = decoded.find_first_of("?&", start);
    const auto resource = decoded.substr(start, end == std::string::npos ? end : end - start);
    if (const char *cover = match_resource(resource)) return cover;
    // Embedded URLs must begin at a query-value boundary, not in a filename,
    // unrelated path, or lookalike hostname.
    start = decoded.find('=', start);
    if (start == std::string::npos) break;
    ++start;
  }
  return url;
}
}  // namespace energydeck_artwork
