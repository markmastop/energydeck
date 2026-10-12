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
  // Skip this unreliable TuneIn cover, including encoded proxy URLs.
  // Station playback and other artwork remain unaffected.
  if (path.find("/s106736/") != std::string::npos ||
      path.find("%2Fs106736%2F") != std::string::npos ||
      path.find("%2fs106736%2f") != std::string::npos) return {};
  if (path.find_first_of("\r\n\\") != std::string::npos) return {};
  if (path.rfind("/", 0) == 0 && path.rfind("//", 0) != 0 && path.find("..") == std::string::npos)
    return host + path;
  if (!host.empty() && origin(path) == host) return path;
  for (const auto *proxy : {"https://sali.sonos.superhi.fi/", "https://sali.sonos.radio/",
      "https://i.scdn.co/", "https://image-cdn-ak.spotifycdn.com/",
      "https://image-cdn-fa.spotifycdn.com/", "https://seed-mix-image.spotifycdn.com/"})
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
  std::string cover;
};

class Favorites {
 public:
  std::vector<Favorite> items;
  std::string display_signature() const {
    std::string result;
    for (const auto &item : items) {
      for (const auto *value : {&item.id, &item.title, &item.cover})
        result += std::to_string(value->size()) + ":" + *value;
      result += item.radio ? 'R' : 'M';
    }
    return result;
  }
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
        else if (name == "albumArtURI") f.cover = artwork_url(n.text, host_);
      }
      // Discovery/pinned containers lack a playable resource. Do not create
      // buttons that look playable but lead to a browse-only screen.
      if (f.uri.empty() || f.metadata.empty() || f.title.empty() || f.id.empty()) continue;
      Xml metadata(f.metadata);
      if (f.cover.empty()) f.cover = artwork_url(metadata.text("albumArtURI"), host_);
      auto cls = metadata.text("class");
      if (!metadata.valid || cls.empty()) continue;
      f.radio = cls.find("audioBroadcast") != std::string::npos;
      if (!f.radio && cls.find("playlistContainer") == std::string::npos && cls.find("musicAlbum") == std::string::npos && cls.find("musicTrack") == std::string::npos) continue;
      if (f.title.size() > 512 || f.uri.size() > 8192 || f.metadata.size() > 8192 || f.cover.size() > 8192 || pending_.size() >= 100) { fail(); return; }
      for (const auto &previous : pending_) if (previous.id == f.id) { fail(); return; }
      bytes_ += f.title.size() + f.uri.size() + f.metadata.size() + f.cover.size();
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

// Discovery includes every visible zone; bonded/hidden members are not separate
// selection/grouping targets. Hosts are validated LAN origins from topology.
struct System {
  std::string uuid, name, coordinator, host, coordinator_host, members;
};

class State {
 public:
  std::array<Room, 2> rooms;
  std::vector<System> systems;
  bool systems_known = false;
  bool systems_complete = false;
  int selected = 0;
  bool command_failed = false;
  int command_error = 0;
  bool command_active() const { return commanding_ && has_request(); }
  static constexpr unsigned MAX_FAVORITE_SETTLE_READS = 10;
  uint32_t request_delay_ms() const {
    return commanding_ && target_action_ == 6 && has_request() && request().action.rfind("Get", 0) == 0 ? 200 : 10;
  }
  const Room &current() const { return selected < 2 ? rooms[selected] : extra_; }
  bool explicitly_selected() const { return !explicit_uuid_.empty(); }
  bool uses_pair_controls() const { return !explicitly_selected() && selected < 2 && grouped(); }
  std::string current_name() const {
    for (const auto &s : systems) if (s.uuid == current().uuid) return s.name;
    return explicitly_selected() ? explicit_name_ : current().uuid;
  }
  bool select_system(const std::string &uuid) {
    const auto *s = system(uuid);
    if (!systems_known || !s) return false;
    explicit_uuid_ = uuid;
    explicit_name_ = s->name;
    selected = uuid == rooms[0].uuid ? 0 : uuid == rooms[1].uuid ? 1 : 2;
    if (selected == 2) extra_ = cached_room(*s);
    group_dirty_ = false;
    return true;
  }
  bool grouped() const { return rooms[0].topology && rooms[1].topology && rooms[0].coordinator == rooms[1].coordinator; }
  bool any_playing() const { return system_playing_ || (rooms[0].known() && rooms[0].playing) || (rooms[1].known() && rooms[1].playing) || (selected == 2 && extra_.known() && extra_.playing); }
  bool all_stopped() const { return system_stopped_ && rooms[0].known() && rooms[1].known() && !rooms[0].playing && !rooms[1].playing && !rooms[0].transitioning && !rooms[1].transitioning && (selected != 2 || (extra_.known() && !extra_.playing && !extra_.transitioning)); }
  // The lightweight all-room scan also drives dashboard playback edges. A
  // partial/unknown scan cannot prove a stop, even if both default rooms pause.
  void set_system_activity(bool playing, bool stopped) { system_playing_ = playing; system_stopped_ = stopped; }
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
  // Evaluate before follow_compact_tab consumes the playback edge.
  bool playback_stopped() const { return compact_playing_ && all_stopped(); }
  bool radio_confirmed() const { return grouped() && rooms[0].known() && rooms[1].known() && rooms[0].playing && rooms[1].playing && !rooms[0].tv; }
  bool has_request() const { return cursor_ < requests_.size(); }
  const Request &request() const { return requests_[cursor_]; }
  bool can_volume() const {
    return current().known() && current().volume >= 0 && (!uses_pair_controls() || rooms[1 - selected].volume >= 0);
  }
  bool can_mute() const { return current().known() && current().mute >= 0 && (!uses_pair_controls() || rooms[1-selected].mute >= 0); }
  bool muted() const { return current().mute == 1 && (!uses_pair_controls() || rooms[1-selected].mute == 1); }
  void switch_room() { if (selected < 2 && !grouped()) { selected = 1 - selected; manual_ = true; explicit_uuid_.clear(); } }
  std::string scope() const {
    const auto &r = current();
    return r.topology ? r.uuid + "|" + r.coordinator + "|" + r.members : "";
  }
  void begin(const std::string &living, const std::string &kitchen) {
    if (rooms[0].uuid.empty()) {
      rooms[0].uuid = "RINCON_LIVING"; rooms[1].uuid = "RINCON_KITCHEN";
      rooms[0].host = origin(living); rooms[1].host = origin(kitchen);
    }
    requests_.clear(); cursor_ = 0; topology_ok_ = false; commanding_ = false; read_retried_ = false;
    pending_systems_.clear();
    current_poll_ = -1;
    pending_complete_ = true;
    pending_[2] = Room{};
    if (selected == 2) { pending_[2].uuid = extra_.uuid; pending_[2].host = extra_.host; }
    for (int i = 0; i < 3; ++i) {
      if (i == 2) {
        if (!pending_[2].host.empty()) requests_.push_back({pending_[2].host, "ZoneGroupTopology", "GetZoneGroupState", "", i});
        continue;
      }
      pending_[i] = Room{}; pending_[i].uuid = rooms[i].uuid; pending_[i].host = rooms[i].host;
      if (!pending_[i].host.empty()) requests_.push_back({pending_[i].host, "ZoneGroupTopology", "GetZoneGroupState", "", i});
    }
  }
  // A newly followed room needs its own snapshot, not another full system poll.
  // Reuse the topology just discovered by this cycle; user commands still do
  // their normal fresh topology/scope check before any write.
  void begin_current() {
    requests_.clear(); cursor_ = 0; commanding_ = false; read_retried_ = false;
    topology_ok_ = systems_known; pending_complete_ = systems_complete;
    pending_systems_ = systems;
    pending_ = {{rooms[0], rooms[1], extra_}};
    current_poll_ = selected;
    const auto *s = system(current().uuid);
    if (!systems_known || !s) return;
    auto &r = pending_[selected];
    r = Room{}; r.uuid = s->uuid; r.host = s->host;
    r.coordinator = s->coordinator; r.coordinator_host = s->coordinator_host;
    r.members = s->members; r.topology = true;
    for (const auto &action : {"GetTransportInfo", "GetMediaInfo", "GetPositionInfo", "GetCurrentTransportActions"})
      requests_.push_back({r.coordinator_host, "AVTransport", action, "<InstanceID>0</InstanceID>", selected});
    requests_.push_back({r.host, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>", selected});
    requests_.push_back({r.host, "RenderingControl", "GetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>", selected});
  }
  void accept(int status, const std::string &body) {
    if (!has_request()) return;
    const auto req = request();
    Xml xml(body);
    const bool ok = status == 200 && xml.valid && xml.has(req.action + "Response") && !xml.has("Fault");
    if (commanding_) {
      const bool settling = target_action_ == 6 && req.action.rfind("Get", 0) == 0;
      // Only read readiness again. A failed/lost write may already have applied,
      // so SetURI, enqueue, Seek and Play are each sent at most once.
      const bool transient = !xml.has("Fault") && (status == 0 || status == 408 || status == 429 ||
        status == 500 || status == 502 || status == 503 || status == 504 || (status == 200 && !ok));
      if (!ok) {
        if (settling && transient && ++favorite_settle_reads_ < MAX_FAVORITE_SETTLE_READS) return;
        command_error = xml.has("Fault") ? std::max(0, number(xml.text("errorCode"))) : 0;
        command_failed = true; requests_.clear(); cursor_ = 0; return;
      }
      if (settling) {
        bool ready = false;
        if (req.action == "GetMediaInfo") ready = xml.text("CurrentURI") == favorite_uri_;
        else if (req.action == "GetTransportInfo") {
          const auto state = xml.text("CurrentTransportState");
          ready = (state == "STOPPED" || state == "PAUSED_PLAYBACK" || state == "PLAYING") &&
                  xml.text("CurrentTransportStatus") != "ERROR_OCCURRED";
        } else if (req.action == "GetPositionInfo") {
          const int track = number(xml.text("Track"));
          ready = track >= favorite_track_ && track < favorite_end_track_;
        }
        if (!ready) {
          if (++favorite_settle_reads_ < MAX_FAVORITE_SETTLE_READS) return;
          command_error = -1; command_failed = true; requests_.clear(); cursor_ = 0; return;
        }
        favorite_settle_reads_ = 0;
      }
      if (target_action_ == 6 && req.action == "SetAVTransportURI") {
        // A successful SetURI acknowledges the change, not completion of the
        // source transition. Do not Seek/Play while the speaker is transitioning.
        requests_.insert(requests_.begin() + cursor_ + 1, {
          {req.host, "AVTransport", "GetMediaInfo", "<InstanceID>0</InstanceID>", target_room_},
          {req.host, "AVTransport", "GetTransportInfo", "<InstanceID>0</InstanceID>", target_room_}});
        favorite_settle_reads_ = 0;
      } else if (target_action_ == 6 && req.action == "Seek") {
        requests_.insert(requests_.begin() + cursor_ + 1,
          {req.host, "AVTransport", "GetPositionInfo", "<InstanceID>0</InstanceID>", target_room_});
        favorite_settle_reads_ = 0;
      }
      if (req.action == "AddURIToQueue") {
        const int first = number(xml.text("FirstTrackNumberEnqueued"));
        const int added = number(xml.text("NumTracksAdded"));
        if (first <= 0 || added <= 0) { command_error = -2; command_failed = true; requests_.clear(); cursor_ = 0; return; }
        favorite_track_ = first; favorite_end_track_ = first + added;
        const auto &r = room(target_room_);
        const auto uri = "x-rincon-queue:" + r.coordinator + "#0";
        favorite_uri_ = uri;
        requests_.push_back({req.host, "AVTransport", "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>" + xml_escape(uri) + "</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>", target_room_});
        requests_.push_back({req.host, "AVTransport", "Seek", "<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>" + std::to_string(first) + "</Target>", target_room_});
        requests_.push_back({req.host, "AVTransport", "Play", "<InstanceID>0</InstanceID><Speed>1</Speed>", target_room_});
      }
      ++cursor_; return;
    }
    // Retry a transient read once before publishing a missing snapshot. Never
    // repeat writes: a lost response may still have applied the command.
    const bool transient = !xml.has("Fault") && (status == 0 || status == 408 || status == 429 ||
      status == 500 || status == 502 || status == 503 || status == 504 || (status == 200 && !ok));
    if (!ok && transient && !read_retried_) { read_retried_ = true; return; }
    read_retried_ = false;
    if (ok && req.action == "GetZoneGroupState" && !topology_ok_) {
      topology_ok_ = parse_topology(xml.text("ZoneGroupState"));
    } else if (ok && req.room >= 0 && req.action != "GetZoneGroupState") {
      Room &r = pending_[req.room];
      if (req.action == "GetMute") {
        r.mute = number(xml.text("CurrentMute"), 1);
      } else if (req.action == "GetCurrentTransportActions") {
        // Sonos commonly separates actions with comma + space. Trim each token
        // without accepting partial names such as NextTrack or X_DLNA_Next.
        const auto actions = xml.text("Actions");
        r.next = r.previous = false;
        for (size_t start = 0; start < actions.size();) {
          const auto comma = actions.find(',', start);
          const auto token = actions.substr(start, comma == std::string::npos ? comma : comma - start);
          const auto first = token.find_first_not_of(" \t\r\n");
          if (first != std::string::npos) {
            const auto name = token.substr(first, token.find_last_not_of(" \t\r\n") - first + 1);
            r.next |= name == "Next";
            r.previous |= name == "Previous";
          }
          if (comma == std::string::npos) break;
          start = comma + 1;
        }
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
    // Discovery seeds are tried only until one succeeds. Topology supplies
    // coordinator addresses, including leaders outside the default rooms.
    if (req.action == "GetZoneGroupState" && (topology_ok_ || cursor_ == requests_.size())) {
      requests_.resize(cursor_);
      for (int i = 0; i < 3; ++i) if (pending_[i].topology) {
        auto &r = pending_[i];
        if (std::none_of(pending_.begin(), pending_.begin() + i, [&](const Room &other) {
              return other.topology && other.coordinator == r.coordinator;
            })) {
          for (const auto &action : {"GetTransportInfo", "GetMediaInfo", "GetPositionInfo", "GetCurrentTransportActions"})
            requests_.push_back({r.coordinator_host, "AVTransport", action, "<InstanceID>0</InstanceID>", i});
        }
        requests_.push_back({r.host, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>", i});
        requests_.push_back({r.host, "RenderingControl", "GetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel>", i});
      }
    }
  }
  // Transport/media/position arrive before optional action and speaker controls.
  // Publish that usable snapshot without finishing or mutating the read queue.
  bool publish_current() {
    if (current_poll_ < 0) return false;
    auto r = pending_[current_poll_];
    if (!r.known() || r.uuid != current().uuid) return false;
    if (!r.playing || r.tv) { r.title.clear(); r.artist.clear(); r.cover.clear(); }
    room_cache_[r.uuid] = r;
    if (selected < 2) rooms[selected] = r; else extra_ = r;
    return true;
  }
  // Publish discovery before unrelated metadata reads finish. Keep valid cached
  // snapshots, but invalidate controls immediately if a zone moved or vanished.
  bool publish_discovery() {
    if (!topology_ok_) return false;
    systems = pending_systems_;
    systems_known = true;
    systems_complete = pending_complete_;
    for (auto it = room_cache_.begin(); it != room_cache_.end();) {
      if (!system(it->first)) it = room_cache_.erase(it); else ++it;
    }
    for (auto *r : {&rooms[0], &rooms[1], &extra_}) {
      const auto *s = system(r->uuid);
      if (s) *r = cached_room(*s);
      else {
        const auto uuid = r->uuid, host = r->host;
        *r = Room{}; r->uuid = uuid; r->host = host; // Retain recovery seeds only.
      }
    }
    return true;
  }
  void finish() {
    systems = pending_systems_;
    systems_known = topology_ok_;
    systems_complete = topology_ok_ && pending_complete_;
    for (int i = 0; i < 3; ++i) if (pending_[i].topology) {
      // A selected-only poll is fresher than a cached lower-index group member.
      // Full polls still use the first member whose coordinator was requested.
      int source = i;
      if (current_poll_ >= 0 && pending_[current_poll_].topology &&
          pending_[current_poll_].coordinator == pending_[i].coordinator) source = current_poll_;
      else for (int j = 0; j < i; ++j) if (pending_[j].topology && pending_[j].coordinator == pending_[i].coordinator) {
        source = j; break;
      }
      if (source != i) {
        auto identity = pending_[i]; pending_[i] = pending_[source];
        pending_[i].uuid = identity.uuid; pending_[i].host = identity.host;
        pending_[i].volume = identity.volume; pending_[i].mute = identity.mute;
      }
    }
    for (auto &r : pending_) {
      if (!r.known() || !r.playing || r.tv) { r.title.clear(); r.artist.clear(); r.cover.clear(); }
    }
    const auto old_scope = scope();
    // A click may change the visible room while this immutable poll finishes.
    // Publish by UUID, then restore the latest choice rather than its old slot.
    for (const auto &r : pending_) if (!r.uuid.empty()) room_cache_[r.uuid] = r;
    for (auto it = room_cache_.begin(); it != room_cache_.end();) {
      if (!system(it->first)) it = room_cache_.erase(it); else ++it;
    }
    rooms[0] = pending_[0]; rooms[1] = pending_[1];
    if (selected == 2) {
      const auto *s = system(explicit_uuid_);
      if (systems_known && s) extra_ = cached_room(*s);
      else {
        const auto host = extra_.host;  // Keep a discovery seed for recovery.
        extra_ = Room{}; extra_.uuid = explicit_uuid_; extra_.host = host;
      }
    }
    if (old_scope != scope()) manual_ = false;
    if (manual_ && !current().playing) manual_ = false;
    if (!manual_ && !explicitly_selected()) {
      auto score = [](const Room &r) { return !r.known() ? -1 : r.playing ? (r.tv ? 1 : 2) : 0; };
      if (score(rooms[1 - selected]) > score(current())) selected = 1 - selected;
    }
  }
  // Freeze the displayed target before refresh. Abort if regrouping changed its
  // scope in the meantime, so a delayed click cannot control the other room.
  void capture() { captured_room_ = selected; captured_scope_ = scope(); }
  bool prepare_command(int action) {
    selected = captured_room_;
    command_failed = false; command_error = 0; requests_.clear(); cursor_ = 0; commanding_ = true;
    if (action < 0 || action > 5 || captured_scope_.empty() || captured_scope_ != scope() || !current().known()) return false;
    if ((action == 0 && current().tv) || ((action == 1 || action == 2) && !can_volume()) ||
        (action == 3 && (current().tv || !current().previous)) || (action == 4 && (current().tv || !current().next)) ||
        (action == 5 && !can_mute())) return false;
    target_action_ = action; target_scope_ = scope(); target_room_ = selected;
    target_playing_ = !current().playing; target_volumes_ = {{-1, -1, -1}};
    target_pair_ = uses_pair_controls();
    target_mute_ = !muted(); target_track_uri_ = current().track_uri;
    if (action == 0) requests_.push_back({current().coordinator_host, "AVTransport", target_playing_ ? "Play" : "Pause",
      std::string("<InstanceID>0</InstanceID>") + (target_playing_ ? "<Speed>1</Speed>" : ""), selected});
    else if (action == 3 || action == 4) requests_.push_back({current().coordinator_host, "AVTransport", action == 3 ? "Previous" : "Next", "<InstanceID>0</InstanceID>", selected});
    else if (action == 5) {
      for (int i = 0; i < 3; ++i) if (i == selected || (i < 2 && target_pair_))
        requests_.push_back({room(i).host, "RenderingControl", "SetMute", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>" + std::to_string(target_mute_) + "</DesiredMute>", i});
    } else for (int i = 0; i < 3; ++i) if (i == selected || (i < 2 && target_pair_)) {
      target_volumes_[i] = std::max(0, std::min(100, room(i).volume + (action == 1 ? -2 : 2)));
      requests_.push_back({room(i).host, "RenderingControl", "SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" +
        std::to_string(target_volumes_[i]) + "</DesiredVolume>", i});
    }
    return true;
  }
  // A favorite uses the displayed room's existing coordinator. Never create a
  // default group or change volume/mute merely because no room was clicked.
  bool can_favorite() const { return current().known(); }
  bool prepare_favorite(const Favorite &favorite) {
    selected = captured_room_;
    command_failed = false; command_error = 0; requests_.clear(); cursor_ = 0; commanding_ = true;
    if (captured_scope_.empty() || captured_scope_ != scope() || !current().known() || favorite.uri.empty() || favorite.metadata.empty()) return false;
    target_action_ = 6; target_scope_ = scope(); target_room_ = selected;
    favorite_uri_ = favorite.uri; favorite_track_ = -1; favorite_end_track_ = -1; favorite_settle_reads_ = 0;
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
  void sync_group_edit() {
    if (group_dirty_) return;
    group_anchor_ = current().uuid;
    group_baseline_ = inventory_scope();
    group_choices_.clear();
    const auto *anchor = system(group_anchor_);
    if (anchor) for (const auto &s : systems) if (s.coordinator == anchor->coordinator) group_choices_.push_back(s.uuid);
  }
  bool group_checked(const std::string &uuid) const {
    return std::find(group_choices_.begin(), group_choices_.end(), uuid) != group_choices_.end();
  }
  bool group_dirty() const { return group_dirty_; }
  bool group_edit_valid() const {
    return systems_known && systems_complete && system(group_anchor_) && group_anchor_ == current().uuid &&
      group_baseline_ == inventory_scope();
  }
  bool toggle_group(const std::string &uuid) {
    if (!group_edit_valid() || uuid == group_anchor_ || !system(uuid)) return false;
    // Editing around the displayed anchor is also an explicit room choice.
    // Pin it before polls can auto-select a different playing default room.
    const auto *anchor = system(group_anchor_);
    explicit_uuid_ = anchor->uuid;
    explicit_name_ = anchor->name;
    auto it = std::find(group_choices_.begin(), group_choices_.end(), uuid);
    if (it == group_choices_.end()) group_choices_.push_back(uuid);
    else group_choices_.erase(it);
    group_dirty_ = std::any_of(systems.begin(), systems.end(), [&](const System &s) {
      return group_checked(s.uuid) != (s.coordinator == anchor->coordinator);
    });
    return true;
  }
  void reset_group_edit() { group_dirty_ = false; sync_group_edit(); }
  bool prepare_group() {
    requests_.clear(); cursor_ = 0; commanding_ = true; command_failed = false; command_error = 0;
    target_action_ = -1; // Group SetURI must never inherit a preceding favorite's readiness sequence.
    group_expected_.clear();
    if (!group_dirty_ || !group_edit_valid() || !group_checked(group_anchor_)) return false;
    const auto &anchor = *system(group_anchor_);
    if (!current().topology || current().coordinator != anchor.coordinator) return false;
    std::map<std::string, std::string> coordinators;
    for (const auto &s : systems) coordinators[s.coordinator] = s.coordinator;
    // Promote the selected room without clearing the source or detaching it
    // first: standalone detachment can lose the currently playing queue/stream.
    if (anchor.coordinator != anchor.uuid) delegate(anchor.coordinator_host, anchor.uuid);
    coordinators[anchor.coordinator] = anchor.uuid;
    for (const auto &entry : coordinators) if (entry.first != anchor.coordinator && group_checked(entry.first)) {
      const System *remaining = nullptr;
      for (const auto &s : systems) if (s.coordinator == entry.first && !group_checked(s.uuid)) { remaining = &s; break; }
      if (remaining) {
        // Leave unselected rooms playing together when their old leader joins
        // the new group; only explicitly checked rooms move.
        const auto *old_leader = system(entry.first);
        if (!old_leader) { requests_.clear(); return false; }
        delegate(old_leader->host, remaining->uuid);
        coordinators[entry.first] = remaining->uuid;
      }
    }
    for (const auto &s : systems) if (s.coordinator == anchor.coordinator && !group_checked(s.uuid)) {
      requests_.push_back({s.host, "AVTransport", "BecomeCoordinatorOfStandaloneGroup", "<InstanceID>0</InstanceID>", -1});
    }
    // Move followers before old leaders, so whole existing groups cannot hitch
    // a ride accidentally when a selected coordinator changes its transport URI.
    for (bool leaders : {false, true}) for (const auto &s : systems) {
      if (s.uuid != anchor.uuid && group_checked(s.uuid) && s.coordinator != anchor.coordinator &&
          (s.uuid == s.coordinator) == leaders)
        requests_.push_back({s.host, "AVTransport", "SetAVTransportURI", "<InstanceID>0</InstanceID><CurrentURI>x-rincon:" +
          xml_escape(anchor.uuid) + "</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>", -1});
    }
    for (const auto &s : systems) {
      const auto expected = group_checked(s.uuid) ? anchor.uuid :
        s.coordinator == anchor.coordinator ? s.uuid : coordinators[s.coordinator];
      group_expected_.push_back({s.uuid, expected});
    }
    return !requests_.empty();
  }
  bool group_confirmed() const {
    if (command_failed || has_request() || !systems_known || !systems_complete || group_expected_.empty() ||
        systems.size() != group_expected_.size()) return false;
    for (const auto &expected : group_expected_) {
      const auto *s = system(expected.first);
      if (!s || s->coordinator != expected.second) return false;
    }
    return true;
  }
  bool command_confirmed() const {
    const auto &r = room(target_room_);
    if (!r.known() || target_scope_ != r.uuid + "|" + r.coordinator + "|" + r.members) return false;
    if (target_action_ == 0) return !r.transitioning && r.playing == target_playing_;
    if (target_action_ == 3 || target_action_ == 4) return !r.track_uri.empty() && r.track_uri != target_track_uri_;
    if (target_action_ == 5) return r.mute == target_mute_ && (!target_pair_ || rooms[1-target_room_].mute == target_mute_);
    if (target_action_ == 6) return r.playing && r.uri == favorite_uri_ && (favorite_track_ < 0 || (r.track >= favorite_track_ && r.track < favorite_end_track_));
    for (int i = 0; i < 3; ++i) if (target_volumes_[i] >= 0 && room(i).volume != target_volumes_[i]) return false;
    return true;
  }

 private:
  std::array<Room, 3> pending_;
  int current_poll_ = -1;
  Room extra_;
  std::map<std::string, Room> room_cache_;
  const Room &room(int i) const { return i < 2 ? rooms[i] : extra_; }
  std::vector<System> pending_systems_;
  std::vector<Request> requests_;
  size_t cursor_ = 0;
  bool topology_ok_ = false, manual_ = false, commanding_ = false, target_playing_ = false;
  bool compact_playing_ = false, read_retried_ = false, target_pair_ = false;
  bool system_playing_ = false, system_stopped_ = true;
  bool pending_complete_ = true;
  std::string explicit_uuid_, explicit_name_;
  bool group_dirty_ = false;
  std::string group_anchor_, group_baseline_;
  std::vector<std::string> group_choices_;
  std::vector<std::pair<std::string, std::string>> group_expected_;
  int captured_room_ = 0, target_room_ = 0, target_action_ = 0;
  std::string captured_scope_, target_scope_;
  std::string target_track_uri_, favorite_uri_;
  int target_mute_ = 0, favorite_track_ = -1, favorite_end_track_ = -1;
  unsigned favorite_settle_reads_ = 0;
  std::array<int, 3> target_volumes_{{-1, -1, -1}};
  const System *system(const std::string &uuid) const {
    for (const auto &s : systems) if (s.uuid == uuid) return &s;
    return nullptr;
  }
  Room cached_room(const System &s) const {
    const auto found = room_cache_.find(s.uuid);
    if (found != room_cache_.end()) {
      const auto &r = found->second;
      // Cached labels are useful immediately, but regrouping/address changes
      // must invalidate their transport and per-speaker control state.
      if (r.topology && r.host == s.host && r.coordinator == s.coordinator &&
          r.coordinator_host == s.coordinator_host && r.members == s.members) return r;
    }
    Room r; r.uuid = s.uuid; r.host = s.host; r.topology = true;
    r.coordinator = s.coordinator; r.coordinator_host = s.coordinator_host; r.members = s.members;
    return r;
  }
  std::string inventory_scope() const {
    std::string scope;
    for (const auto &s : systems) for (const auto *value : {&s.uuid, &s.host, &s.coordinator, &s.coordinator_host, &s.members})
      scope += std::to_string(value->size()) + ":" + *value;
    return scope;
  }
  void delegate(const std::string &host, const std::string &uuid) {
    // These four inputs match the speakers' AVTransport1.xml service contract.
    requests_.push_back({host, "AVTransport", "DelegateGroupCoordinationTo", "<InstanceID>0</InstanceID><NewCoordinator>" +
      xml_escape(uuid) + "</NewCoordinator><RejoinGroup>1</RejoinGroup><ClearSource>0</ClearSource>", -1});
  }
  bool parse_topology(const std::string &body) {
    Xml xml(body); if (!xml.valid) return false;
    std::array<Room, 3> result = pending_;
    std::vector<System> systems;
    bool complete = true;
    for (size_t gi = 0; gi < xml.nodes.size(); ++gi) {
      const auto &g = xml.nodes[gi]; if (Xml::local(g.name) != "ZoneGroup") continue;
      const auto coordinator = attribute(g, "Coordinator");
      std::string coordinator_host; std::vector<std::string> members;
      for (const auto &n : xml.nodes) if (n.parent == static_cast<int>(gi) && Xml::local(n.name) == "ZoneGroupMember") {
        auto uuid = attribute(n, "UUID"); members.push_back(uuid);
        if (uuid == coordinator) coordinator_host = origin(attribute(n, "Location"));
      }
      if (coordinator.empty() || coordinator_host.empty()) { complete = false; continue; }
      std::sort(members.begin(), members.end()); std::string signature;
      for (const auto &uuid : members) signature += uuid + ";";
      for (const auto &n : xml.nodes) if (n.parent == static_cast<int>(gi) && Xml::local(n.name) == "ZoneGroupMember") {
        const auto uuid = attribute(n, "UUID");
        const auto host = origin(attribute(n, "Location"));
        if (attribute(n, "Invisible") != "1" && (uuid.empty() || host.empty())) complete = false;
        if (!uuid.empty() && !host.empty() && attribute(n, "Invisible") != "1") {
          const auto name = attribute(n, "ZoneName");
          const auto duplicate = std::find_if(systems.begin(), systems.end(), [&](const System &s) { return s.uuid == uuid; });
          if (duplicate == systems.end()) {
            if (systems.size() < 32) systems.push_back({uuid, name.empty() ? uuid : name, coordinator, host, coordinator_host, signature});
            else complete = false;
          } else if (duplicate->host != host || duplicate->coordinator != coordinator) complete = false;
        }
        for (auto &r : result) if (!r.uuid.empty() && uuid == r.uuid) {
          auto host = origin(attribute(n, "Location")); if (host.empty()) continue;
          r.host = host; r.coordinator = coordinator; r.coordinator_host = coordinator_host; r.members = signature; r.topology = true;
        }
      }
    }
    if (!result[0].topology && !result[1].topology && !result[2].topology) return false;
    std::sort(systems.begin(), systems.end(), [](const System &a, const System &b) {
      return a.name == b.name ? a.uuid < b.uuid : a.name < b.name;
    });
    pending_systems_ = std::move(systems);
    pending_complete_ = complete;
    pending_ = result; return true;
  }
};
// Lightweight room-list/dashboard activity: existing polled coordinators are reused;
// each remaining coordinator gets one read-only transport request per cycle.
// Group followers share their coordinator's activity, never separate requests.
class RoomActivity {
 public:
  enum Transport { UNKNOWN, STOPPED, PLAYING, TRANSITIONING };
  void begin(const State &state) {
    pending_.clear(); requests_.clear(); coordinators_.clear(); cursor_ = 0;
    const Room *polled[] = {&state.rooms[0], &state.rooms[1], &state.current()};
    for (const auto &system : state.systems) {
      if (pending_.count(system.coordinator)) continue;
      pending_[system.coordinator] = UNKNOWN;
      bool already_polled = false;
      for (const auto *room : polled) {
        if (!room->topology || room->coordinator != system.coordinator) continue;
        already_polled = true;
        if (room->transport) pending_[system.coordinator] = room->transitioning ? TRANSITIONING : room->playing ? PLAYING : STOPPED;
        break;
      }
      if (!already_polled && !system.coordinator.empty() && !system.coordinator_host.empty() &&
          origin(system.coordinator_host) == system.coordinator_host) {
        coordinators_.push_back(system.coordinator);
        requests_.push_back({system.coordinator_host, "AVTransport", "GetTransportInfo", "<InstanceID>0</InstanceID>"});
      }
    }
    // A bounded scan may stop early for touch commands or slow/offline groups.
    // Rotate its starting point so later zones still get turns on future polls.
    if (!requests_.empty()) {
      const size_t start = cycle_++ % requests_.size();
      std::rotate(requests_.begin(), requests_.begin() + start, requests_.end());
      std::rotate(coordinators_.begin(), coordinators_.begin() + start, coordinators_.end());
    }
  }
  bool has_request() const { return cursor_ < requests_.size(); }
  const Request &request() const { return requests_[cursor_]; }
  void accept(int status, const std::string &body) {
    if (!has_request()) return;
    Xml xml(body);
    if (status == 200 && xml.valid && xml.has("GetTransportInfoResponse") && !xml.has("Fault")) {
      const auto transport = xml.text("CurrentTransportState");
      pending_[coordinators_[cursor_]] = transport == "PLAYING" ? PLAYING : transport == "TRANSITIONING" ? TRANSITIONING :
        transport == "STOPPED" || transport == "PAUSED_PLAYBACK" || transport == "NO_MEDIA_PRESENT" ? STOPPED : UNKNOWN;
    }
    ++cursor_;
  }
  void finish() { activity_ = pending_; }
  Transport transport(const System &system) const {
    const auto found = activity_.find(system.coordinator);
    return found == activity_.end() ? UNKNOWN : found->second;
  }
  // Keep a playing target stable when several rooms play. Only the dashboard
  // may change targets; detail navigation and in-flight controls stay pinned.
  bool follow_dashboard(State &state, bool allow_selection) const {
    bool playing = false;
    bool stopped = state.systems_known && state.systems_complete && !state.systems.empty();
    bool current_playing = false;
    for (const auto &system : state.systems) {
      const auto value = transport(system);
      playing |= value == PLAYING;
      stopped &= value == STOPPED;
      current_playing |= system.uuid == state.current().uuid && value == PLAYING;
    }
    state.set_system_activity(playing, stopped);
    if (!allow_selection || current_playing || !playing) return false;
    // Use the same deterministic alphabetical order as Rooms for a new target.
    for (const auto index : order(state)) {
      const auto &system = state.systems[index];
      if (transport(system) == PLAYING) return state.select_system(system.uuid);
    }
    return false;
  }
  std::vector<size_t> order(const State &state) const {
    std::vector<size_t> indices;
    std::vector<std::string> names;
    for (size_t i = 0; i < state.systems.size(); ++i) {
      indices.push_back(i);
      std::string name = state.systems[i].name;
      // ASCII case folding matches the configured Dutch room names and avoids
      // locale-dependent ordering on the ESP32. Preserve the original UI text.
      for (char &c : name) if (c >= 'A' && c <= 'Z') c += 'a' - 'A';
      names.push_back(std::move(name));
    }
    std::sort(indices.begin(), indices.end(), [&](size_t a, size_t b) {
      const bool playing_a = this->transport(state.systems[a]) == PLAYING;
      const bool playing_b = this->transport(state.systems[b]) == PLAYING;
      if (playing_a != playing_b) return playing_a;
      if (names[a] != names[b]) return names[a] < names[b];
      return state.systems[a].uuid < state.systems[b].uuid;
    });
    return indices;
  }

 private:
  size_t cursor_{0};
  size_t cycle_{0};
  std::vector<Request> requests_;
  std::vector<std::string> coordinators_;
  std::map<std::string, Transport> pending_, activity_;
};
}  // namespace energydeck_sonos
