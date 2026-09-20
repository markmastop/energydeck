#pragma once

// Small, dependency-free Sonos SOAP model, shared by host tests and firmware.
// HTTP is scheduled by ESPHome between requests, never from the render lambda.
#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

namespace energydeck_sonos {

inline std::string unescape(const std::string &s) {
  std::string out;
  for (size_t i = 0; i < s.size(); ++i) {
    if (s[i] != '&') { out += s[i]; continue; }
    const auto end = s.find(';', i + 1);
    if (end == std::string::npos || end - i > 12) { out += s[i]; continue; }
    const auto e = s.substr(i + 1, end - i - 1);
    if (e == "amp") out += '&';
    else if (e == "lt") out += '<';
    else if (e == "gt") out += '>';
    else if (e == "quot") out += '"';
    else if (e == "apos") out += '\'';
    else if (!e.empty() && e[0] == '#') {
      char *tail = nullptr;
      const bool hex = e.size() > 1 && (e[1] == 'x' || e[1] == 'X');
      const char *digits = e.c_str() + (hex ? 2 : 1);
      unsigned long c = std::strtoul(digits, &tail, hex ? 16 : 10);
      if (tail == digits || *tail || !c || c > 0x10FFFF || (c >= 0xD800 && c <= 0xDFFF)) return {};
      if (c < 0x80) out += char(c);
      else if (c < 0x800) { out += char(0xC0 | (c >> 6)); out += char(0x80 | (c & 63)); }
      else if (c < 0x10000) { out += char(0xE0 | (c >> 12)); out += char(0x80 | ((c >> 6) & 63)); out += char(0x80 | (c & 63)); }
      else { out += char(0xF0 | (c >> 18)); out += char(0x80 | ((c >> 12) & 63)); out += char(0x80 | ((c >> 6) & 63)); out += char(0x80 | (c & 63)); }
    } else { out += s.substr(i, end - i + 1); }
    i = end;
  }
  return out;
}

struct Node {
  std::string name, text;
  std::map<std::string, std::string> attrs;
  int parent = -1;
};

// Only the bounded XML subset emitted by Sonos is accepted. No DTD/external
// entities, no recursive entity expansion, and truncated responses fail closed.
struct Xml {
  std::vector<Node> nodes;
  bool valid = false;
  explicit Xml(const std::string &s) {
    if (s.empty() || s.size() > 65536) return;
    std::vector<int> stack;
    size_t pos = 0;
    while (pos < s.size()) {
      if (s[pos] != '<') {
        auto end = s.find('<', pos); if (end == std::string::npos) end = s.size();
        if (!stack.empty()) nodes[stack.back()].text += unescape(s.substr(pos, end - pos));
        pos = end; continue;
      }
      if (s.compare(pos, 9, "<![CDATA[") == 0) {
        auto end = s.find("]]>", pos + 9); if (end == std::string::npos || stack.empty()) return;
        nodes[stack.back()].text += s.substr(pos + 9, end - pos - 9); pos = end + 3; continue;
      }
      if (s.compare(pos, 4, "<!--") == 0 || s.compare(pos, 2, "<?") == 0) {
        const bool comment = s.compare(pos, 4, "<!--") == 0;
        auto end = s.find(comment ? "-->" : "?>", pos + 2); if (end == std::string::npos) return;
        pos = end + (comment ? 3 : 2); continue;
      }
      if (s.compare(pos, 2, "<!") == 0) return;
      size_t end = pos + 1; char quote = 0;
      for (; end < s.size(); ++end) {
        char c = s[end];
        if (quote) { if (c == quote) quote = 0; }
        else if (c == '\'' || c == '"') quote = c;
        else if (c == '>') break;
      }
      if (end == s.size()) return;
      std::string tag = s.substr(pos + 1, end - pos - 1); pos = end + 1;
      bool close = !tag.empty() && tag.front() == '/';
      bool self = !tag.empty() && tag.back() == '/';
      if (close) tag.erase(0, 1);
      if (self) tag.pop_back();
      size_t n = 0; while (n < tag.size() && !std::isspace(static_cast<unsigned char>(tag[n]))) ++n;
      const auto name = tag.substr(0, n); if (name.empty()) return;
      if (close) {
        if (stack.empty() || nodes[stack.back()].name != name) return;
        stack.pop_back(); continue;
      }
      if (nodes.size() >= 1024 || stack.size() >= 32) return;
      Node node; node.name = name; node.parent = stack.empty() ? -1 : stack.back();
      while (n < tag.size()) {
        while (n < tag.size() && std::isspace(static_cast<unsigned char>(tag[n]))) ++n;
        if (n == tag.size()) break;
        size_t a = n;
        while (n < tag.size() && tag[n] != '=' && !std::isspace(static_cast<unsigned char>(tag[n]))) ++n;
        std::string key = tag.substr(a, n - a);
        while (n < tag.size() && std::isspace(static_cast<unsigned char>(tag[n]))) ++n;
        if (n == tag.size() || tag[n++] != '=') return;
        while (n < tag.size() && std::isspace(static_cast<unsigned char>(tag[n]))) ++n;
        if (n == tag.size() || (tag[n] != '\'' && tag[n] != '"')) return;
        char q = tag[n++]; a = n; n = tag.find(q, n);
        if (n == std::string::npos) return;
        node.attrs[key] = unescape(tag.substr(a, n - a)); ++n;
      }
      nodes.push_back(node);
      if (!self) stack.push_back(static_cast<int>(nodes.size()) - 1);
    }
    valid = !nodes.empty() && stack.empty();
  }
  static std::string local(const std::string &s) { auto p = s.find(':'); return p == std::string::npos ? s : s.substr(p + 1); }
  std::string text(const std::string &name) const {
    if (valid) for (const auto &n : nodes) if (local(n.name) == name) return n.text;
    return {};
  }
  bool has(const std::string &name) const {
    if (valid) for (const auto &n : nodes) if (local(n.name) == name) return true;
    return false;
  }
};

inline std::string attribute(const Node &n, const std::string &key) {
  const auto it = n.attrs.find(key); return it == n.attrs.end() ? "" : it->second;
}

// Sonos endpoints are LAN IPv4:1400 only; reject arbitrary URL origins supplied
// in topology/artwork. No Homey credentials are ever attached to these requests.
inline std::string origin(const std::string &url) {
  if (url.rfind("http://", 0) != 0) return {};
  auto end = url.find('/', 7); auto host = url.substr(7, end == std::string::npos ? end : end - 7);
  if (host.size() < 6 || host.substr(host.size() - 5) != ":1400") return {};
  std::string ip = host.substr(0, host.size() - 5); int bytes[4] = {}; size_t start = 0;
  for (int i = 0; i < 4; ++i) {
    auto dot = ip.find('.', start);
    if ((i < 3) != (dot != std::string::npos)) return {};
    auto part = ip.substr(start, dot == std::string::npos ? dot : dot - start);
    if (part.empty() || part.size() > 3) return {};
    for (char c : part) { if (c < '0' || c > '9') return {}; bytes[i] = bytes[i] * 10 + c - '0'; }
    if (bytes[i] > 255) return {};
    start = dot + 1;
  }
  if (!(bytes[0] == 10 || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) || (bytes[0] == 192 && bytes[1] == 168))) return {};
  return "http://" + host;
}

// Artwork may come from the coordinator or Sonos' HTTPS radio image proxies.
// Never attach Homey credentials or accept arbitrary metadata-provided hosts.
inline std::string artwork_url(const std::string &path, const std::string &host) {
  if (path.find_first_of("\r\n\\") != std::string::npos) return {};
  if (path.rfind("/", 0) == 0 && path.rfind("//", 0) != 0 && path.find("..") == std::string::npos)
    return host + path;
  if (!host.empty() && origin(path) == host) return path;
  for (const auto *proxy : {"https://sali.sonos.superhi.fi/", "https://sali.sonos.radio/"})
    if (path.rfind(proxy, 0) == 0) return path;
  return {};
}

struct Room {
  std::string uuid, host, coordinator, coordinator_host, members;
  std::string title, artist, cover, uri, track_uri, station, station_cover;
  int volume = -1, mute = -1, track = -1;
  bool next = false, previous = false;
  bool topology = false, transport = false, media = false, position = false;
  bool playing = false, tv = false, transitioning = false;
  bool known() const { return topology && transport && media && position; }
};

struct Request {
  std::string host, service, action, arguments;
  int room = -1;
  std::string url() const {
    return host + (service == "ContentDirectory" ? "/MediaServer/ContentDirectory/Control" :
      service == "ZoneGroupTopology" ? "/ZoneGroupTopology/Control" :
      service == "RenderingControl" ? "/MediaRenderer/RenderingControl/Control" : "/MediaRenderer/AVTransport/Control");
  }
  std::string soap_action() const { return "\"urn:schemas-upnp-org:service:" + service + ":1#" + action + "\""; }
  std::string body() const {
    return "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action +
      " xmlns:u=\"urn:schemas-upnp-org:service:" + service + ":1\">" + arguments + "</u:" + action + "></s:Body></s:Envelope>";
  }
};

inline std::string xml_escape(const std::string &s) {
  std::string result;
  for (char c : s) {
    switch (c) {
      case '&': result += "&amp;"; break;
      case '<': result += "&lt;"; break;
      case '>': result += "&gt;"; break;
      case '"': result += "&quot;"; break;
      case '\'': result += "&apos;"; break;
      default: result += c;
    }
  }
  return result;
}

inline int number(const std::string &s, int maximum = 100000) {
  if (s.empty() || s.size() > 6) return -1;
  int n = 0;
  for (char c : s) { if (c < '0' || c > '9') return -1; n = n * 10 + c - '0'; }
  return n > maximum ? -1 : n;
}

struct Favorite {
  std::string id, title, uri, metadata;
  bool radio = false;
};

class Favorites {
 public:
  std::vector<Favorite> items;
  bool known = false, failed = false;
  void begin(const std::string &host) {
    host_ = origin(host); offset_ = 0; bytes_ = 0; pending_.clear(); version_.clear();
    known = false; failed = host_.empty(); active_ = !failed;
  }
  bool has_request() const { return active_; }
  Request request() const {
    return {host_, "ContentDirectory", "Browse", "<ObjectID>FV:2</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>" +
      std::to_string(offset_) + "</StartingIndex><RequestedCount>8</RequestedCount><SortCriteria></SortCriteria>", -1};
  }
  void accept(int status, const std::string &body) {
    if (!active_) return;
    Xml response(body);
    if (status != 200 || !response.valid || !response.has("BrowseResponse") || response.has("Fault")) { fail(); return; }
    const int returned = number(response.text("NumberReturned"), 8);
    const int total = number(response.text("TotalMatches"), 100);
    const auto version = response.text("UpdateID");
    if (returned < 0 || total < 0 || offset_ + returned > total || (returned == 0 && offset_ < total) ||
        (offset_ > 0 && version != version_)) { fail(); return; }
    version_ = version;
    Xml didl(response.text("Result"));
    if (returned && !didl.valid) { fail(); return; }
    int entries = 0;
    for (size_t i = 0; i < didl.nodes.size(); ++i) {
      const auto &item = didl.nodes[i];
      if (item.parent != 0 || (Xml::local(item.name) != "item" && Xml::local(item.name) != "container")) continue;
      ++entries;
      Favorite f; f.id = attribute(item, "id");
      for (const auto &n : didl.nodes) if (n.parent == static_cast<int>(i)) {
        auto name = Xml::local(n.name);
        if (name == "title") f.title = n.text;
        else if (name == "res") f.uri = n.text;
        else if (name == "resMD") f.metadata = n.text;
      }
      // Discovery/pinned containers lack a playable resource. Do not create
      // buttons that look playable but lead to a browse-only screen.
      if (f.uri.empty() || f.metadata.empty() || f.title.empty() || f.id.empty()) continue;
      Xml metadata(f.metadata);
      auto cls = metadata.text("class");
      if (!metadata.valid || cls.empty()) continue;
      f.radio = cls.find("audioBroadcast") != std::string::npos;
      if (!f.radio && cls.find("playlistContainer") == std::string::npos && cls.find("musicAlbum") == std::string::npos && cls.find("musicTrack") == std::string::npos) continue;
      if (f.title.size() > 512 || f.uri.size() > 8192 || f.metadata.size() > 8192 || pending_.size() >= 100) { fail(); return; }
      for (const auto &previous : pending_) if (previous.id == f.id) { fail(); return; }
      bytes_ += f.title.size() + f.uri.size() + f.metadata.size();
      if (bytes_ > 196608) { fail(); return; }
      pending_.push_back(std::move(f));
    }
    if (entries != returned) { fail(); return; }
    offset_ += returned;
    if (offset_ == total) {
      items.swap(pending_); pending_.clear(); known = true; active_ = false;
    }
  }

 private:
  bool active_ = false;
  int offset_ = 0;
  size_t bytes_ = 0;
  std::string host_, version_;
  std::vector<Favorite> pending_;
  void fail() { active_ = false; failed = true; known = false; pending_.clear(); }
};

class State {
 public:
  std::array<Room, 2> rooms;
  int selected = 0;
  bool command_failed = false;
  const Room &current() const { return rooms[selected]; }
  bool grouped() const { return rooms[0].topology && rooms[1].topology && rooms[0].coordinator == rooms[1].coordinator; }
  bool any_playing() const { return (rooms[0].known() && rooms[0].playing) || (rooms[1].known() && rooms[1].playing); }
  bool all_stopped() const { return rooms[0].known() && rooms[1].known() && !rooms[0].playing && !rooms[1].playing && !rooms[0].transitioning && !rooms[1].transitioning; }
  // Follow playback edges, not every poll: manual Gas/Climate selections remain
  // usable during playback. Unknown/transitioning replies never imply a stop.
  int follow_compact_tab(int tab) {
    if (any_playing()) {
      const bool started = !compact_playing_;
      compact_playing_ = true;
      return started ? 1 : tab;
    }
    if (all_stopped()) {
      const bool stopped = compact_playing_;
      compact_playing_ = false;
      if (stopped && tab == 1) return 0;
    }
    return tab;
  }
  bool radio_confirmed() const { return grouped() && rooms[0].known() && rooms[1].known() && rooms[0].playing && rooms[1].playing && !rooms[0].tv; }
  bool has_request() const { return cursor_ < requests_.size(); }
  const Request &request() const { return requests_[cursor_]; }
  bool can_volume() const {
    return current().known() && current().volume >= 0 && (!grouped() || rooms[1 - selected].volume >= 0);
  }
  bool can_mute() const { return current().known() && current().mute >= 0 && (!grouped() || rooms[1-selected].mute >= 0); }
  bool muted() const { return current().mute == 1 && (!grouped() || rooms[1-selected].mute == 1); }
  void switch_room() { if (!grouped()) { selected = 1 - selected; manual_ = true; } }
  std::string scope() const {
    const auto &r = current();
    return r.topology ? r.uuid + "|" + r.coordinator + "|" + r.members : "";
  }
  void begin(const std::string &living, const std::string &kitchen) {
    if (rooms[0].uuid.empty()) {
      rooms[0].uuid = "RINCON_542A1BE6F81C01400"; rooms[1].uuid = "RINCON_542A1BE6F89101400";
      rooms[0].host = origin(living); rooms[1].host = origin(kitchen);
    }
    requests_.clear(); cursor_ = 0; topology_ok_ = false; commanding_ = false;
    for (int i = 0; i < 2; ++i) {
      pending_[i] = Room{}; pending_[i].uuid = rooms[i].uuid; pending_[i].host = rooms[i].host;
      if (!pending_[i].host.empty()) requests_.push_back({pending_[i].host, "ZoneGroupTopology", "GetZoneGroupState", "", i});
    }
  }
  void accept(int status, const std::string &body) {
    if (!has_request()) return;
    const auto req = request();
    Xml xml(body);
    const bool ok = status == 200 && xml.valid && xml.has(req.action + "Response") && !xml.has("Fault");
    if (commanding_) {
      if (!ok) { command_failed = true; requests_.clear(); cursor_ = 0; return; }
      if (req.action == "AddURIToQueue") {
        const int first = number(xml.text("FirstTrackNumberEnqueued"));
        const int added = number(xml.text("NumTracksAdded"));
        if (first <= 0 || added <= 0) { command_failed = true; requests_.clear(); cursor_ = 0; return; }
        favorite_track_ = first;
        const auto &r = rooms[target_room_];
        const auto uri = "x-rincon-queue:" + r.coordinator + "#0";
        favorite_uri_ = uri;
        requests_.push_back({req.host, "AVTransport", "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>" + xml_escape(uri) + "</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>", target_room_});
        requests_.push_back({req.host, "AVTransport", "Seek", "<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>" + std::to_string(first) + "</Target>", target_room_});
        requests_.push_back({req.host, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>", target_room_});
      }
      ++cursor_; return;
    }
    if (ok && req.action == "GetZoneGroupState" && !topology_ok_) {
      topology_ok_ = parse_topology(xml.text("ZoneGroupState"));
    } else if (ok && req.room >= 0 && req.action != "GetZoneGroupState") {
      Room &r = pending_[req.room];
      if (req.action == "GetMute") {
        r.mute = number(xml.text("CurrentMute"), 1);
      } else if (req.action == "GetCurrentTransportActions") {
        const auto actions = "," + xml.text("Actions") + ",";
        r.next = actions.find(",Next,") != std::string::npos;
        r.previous = actions.find(",Previous,") != std::string::npos;
      } else if (req.action == "GetVolume") {
        const auto value = xml.text("CurrentVolume");
        if (!value.empty() && value.size() <= 3 && std::all_of(value.begin(), value.end(), [](char c) { return c >= '0' && c <= '9'; })) {
          int v = std::atoi(value.c_str()); if (v <= 100) r.volume = v;
        }
      } else if (req.action == "GetTransportInfo") {
        auto state = xml.text("CurrentTransportState");
        r.transport = state == "PLAYING" || state == "PAUSED_PLAYBACK" || state == "STOPPED" || state == "NO_MEDIA_PRESENT" || state == "TRANSITIONING";
        r.playing = state == "PLAYING";
        r.transitioning = state == "TRANSITIONING";
      } else if (req.action == "GetMediaInfo") {
        r.media = xml.has("CurrentURI"); r.uri = xml.text("CurrentURI");
        r.tv = r.uri.rfind("x-sonos-htastream:", 0) == 0;
        Xml media(xml.text("CurrentURIMetaData"));
        r.station = media.text("title");
        r.station_cover = artwork_url(media.text("albumArtURI"), r.coordinator_host);
      } else if (req.action == "GetPositionInfo") {
        r.position = xml.has("TrackMetaData");
        r.track_uri = xml.text("TrackURI"); r.track = number(xml.text("Track"));
        Xml meta(xml.text("TrackMetaData"));
        r.title = meta.text("title"); r.artist = meta.text("creator");
        // Radio services often put artist/title in streamContent instead.
        auto stream = meta.text("streamContent");
        if (!stream.empty()) { r.artist = r.station; r.title = stream; }
        r.cover = artwork_url(meta.text("albumArtURI"), r.coordinator_host);
        if (r.cover.empty()) r.cover = r.station_cover;
      }
    }
    ++cursor_;
    // Both seed devices are tried only if necessary. Topology supplies current
    // coordinator addresses, including group leaders outside these two rooms.
    if (req.action == "GetZoneGroupState" && (topology_ok_ || cursor_ == requests_.size())) {
      requests_.resize(cursor_);
      for (int i = 0; i < 2; ++i) if (pending_[i].topology) {
        auto &r = pending_[i];
        if (i == 0 || r.coordinator != pending_[0].coordinator) {
          for (const auto &action : {"GetTransportInfo", "GetMediaInfo", "GetPositionInfo", "GetCurrentTransportActions"})
            requests_.push_back({r.coordinator_host, "AVTransport", action, "<InstanceID>0</InstanceID>", i});
        }
        requests_.push_back({r.host, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>", i});
        requests_.push_back({r.host, "RenderingControl", "GetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>", i});
      }
    }
  }
  void finish() {
    if (pending_[0].topology && pending_[1].topology && pending_[0].coordinator == pending_[1].coordinator) {
      auto identity = pending_[1]; pending_[1] = pending_[0];
      pending_[1].uuid = identity.uuid; pending_[1].host = identity.host; pending_[1].volume = identity.volume; pending_[1].mute = identity.mute;
    }
    for (auto &r : pending_) {
      if (!r.known() || !r.playing || r.tv) { r.title.clear(); r.artist.clear(); r.cover.clear(); }
    }
    const auto old_scope = scope();
    rooms = pending_;
    if (old_scope != scope()) manual_ = false;
    if (manual_ && !current().playing) manual_ = false;
    if (!manual_) {
      auto score = [](const Room &r) { return !r.known() ? -1 : r.playing ? (r.tv ? 1 : 2) : 0; };
      if (score(rooms[1 - selected]) > score(current())) selected = 1 - selected;
    }
  }
  // Freeze the displayed target before refresh. Abort if regrouping changed its
  // scope in the meantime, so a delayed click cannot control the other room.
  void capture() { captured_room_ = selected; captured_scope_ = scope(); }
  bool prepare_command(int action) {
    selected = captured_room_;
    command_failed = false; requests_.clear(); cursor_ = 0; commanding_ = true;
    if (action < 0 || action > 5 || captured_scope_.empty() || captured_scope_ != scope() || !current().known()) return false;
    if ((action == 0 && current().tv) || ((action == 1 || action == 2) && !can_volume()) ||
        (action == 3 && (current().tv || !current().previous)) || (action == 4 && (current().tv || !current().next)) ||
        (action == 5 && !can_mute())) return false;
    target_action_ = action; target_scope_ = scope(); target_room_ = selected;
    target_playing_ = !current().playing; target_volumes_ = {{-1, -1}};
    target_mute_ = !muted(); target_track_uri_ = current().track_uri;
    if (action == 0) requests_.push_back({current().coordinator_host, "AVTransport", target_playing_ ? "Play" : "Pause",
      std::string("<InstanceID>0</InstanceID>") + (target_playing_ ? "<Speed>1</Speed>" : ""), selected});
    else if (action == 3 || action == 4) requests_.push_back({current().coordinator_host, "AVTransport", action == 3 ? "Previous" : "Next", "<InstanceID>0</InstanceID>", selected});
    else if (action == 5) {
      for (int i = 0; i < 2; ++i) if (i == selected || grouped())
        requests_.push_back({rooms[i].host, "RenderingControl", "SetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>" + std::to_string(target_mute_) + "</DesiredMute>", i});
    } else for (int i = 0; i < 2; ++i) if (i == selected || grouped()) {
      target_volumes_[i] = std::max(0, std::min(100, rooms[i].volume + (action == 1 ? -2 : 2)));
      requests_.push_back({rooms[i].host, "RenderingControl", "SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" +
        std::to_string(target_volumes_[i]) + "</DesiredVolume>", i});
    }
    return true;
  }
  bool prepare_favorite(const Favorite &favorite) {
    selected = captured_room_;
    command_failed = false; requests_.clear(); cursor_ = 0; commanding_ = true;
    if (captured_scope_.empty() || captured_scope_ != scope() || !current().known() || favorite.uri.empty() || favorite.metadata.empty()) return false;
    target_action_ = 6; target_scope_ = scope(); target_room_ = selected;
    favorite_uri_ = favorite.uri; favorite_track_ = -1;
    if (favorite.radio) {
      requests_.push_back({current().coordinator_host, "AVTransport", "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>" + xml_escape(favorite.uri) +
        "</CurrentURI><CurrentURIMetaData>" + xml_escape(favorite.metadata) + "</CurrentURIMetaData>", selected});
      requests_.push_back({current().coordinator_host, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>", selected});
    } else {
      // Append; never clear/replace a user-curated queue. Only a successful
      // enqueue response may schedule queue selection, seek and playback.
      requests_.push_back({current().coordinator_host, "AVTransport", "AddURIToQueue", "<InstanceID>0</InstanceID><EnqueuedURI>" + xml_escape(favorite.uri) +
        "</EnqueuedURI><EnqueuedURIMetaData>" + xml_escape(favorite.metadata) + "</EnqueuedURIMetaData><DesiredFirstTrackNumberEnqueued>0</DesiredFirstTrackNumberEnqueued><EnqueueAsNext>0</EnqueueAsNext>", selected});
    }
    return true;
  }
  bool command_confirmed() const {
    const auto &r = rooms[target_room_];
    if (!r.known() || target_scope_ != r.uuid + "|" + r.coordinator + "|" + r.members) return false;
    if (target_action_ == 0) return r.playing == target_playing_;
    if (target_action_ == 3 || target_action_ == 4) return !r.track_uri.empty() && r.track_uri != target_track_uri_;
    if (target_action_ == 5) return r.mute == target_mute_ && (!grouped() || rooms[1-target_room_].mute == target_mute_);
    if (target_action_ == 6) return r.playing && r.uri == favorite_uri_ && (favorite_track_ < 0 || r.track == favorite_track_);
    for (int i = 0; i < 2; ++i) if (target_volumes_[i] >= 0 && rooms[i].volume != target_volumes_[i]) return false;
    return true;
  }

 private:
  std::array<Room, 2> pending_;
  std::vector<Request> requests_;
  size_t cursor_ = 0;
  bool topology_ok_ = false, manual_ = false, commanding_ = false, target_playing_ = false;
  bool compact_playing_ = false;
  int captured_room_ = 0, target_room_ = 0, target_action_ = 0;
  std::string captured_scope_, target_scope_;
  std::string target_track_uri_, favorite_uri_;
  int target_mute_ = 0, favorite_track_ = -1;
  std::array<int, 2> target_volumes_{{-1, -1}};
  bool parse_topology(const std::string &body) {
    Xml xml(body); if (!xml.valid) return false;
    std::array<Room, 2> result = pending_;
    for (size_t gi = 0; gi < xml.nodes.size(); ++gi) {
      const auto &g = xml.nodes[gi]; if (Xml::local(g.name) != "ZoneGroup") continue;
      const auto coordinator = attribute(g, "Coordinator");
      std::string coordinator_host; std::vector<std::string> members;
      for (const auto &n : xml.nodes) if (n.parent == static_cast<int>(gi) && Xml::local(n.name) == "ZoneGroupMember") {
        auto uuid = attribute(n, "UUID"); members.push_back(uuid);
        if (uuid == coordinator) coordinator_host = origin(attribute(n, "Location"));
      }
      if (coordinator.empty() || coordinator_host.empty()) continue;
      std::sort(members.begin(), members.end()); std::string signature;
      for (const auto &uuid : members) signature += uuid + ";";
      for (const auto &n : xml.nodes) if (n.parent == static_cast<int>(gi) && Xml::local(n.name) == "ZoneGroupMember") {
        for (auto &r : result) if (attribute(n, "UUID") == r.uuid) {
          auto host = origin(attribute(n, "Location")); if (host.empty()) continue;
          r.host = host; r.coordinator = coordinator; r.coordinator_host = coordinator_host; r.members = signature; r.topology = true;
        }
      }
    }
    if (!result[0].topology && !result[1].topology) return false;
    pending_ = result; return true;
  }
};
}  // namespace energydeck_sonos
