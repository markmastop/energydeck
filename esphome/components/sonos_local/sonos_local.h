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

struct Room {
  std::string uuid, host, coordinator, coordinator_host, members;
  std::string title, artist, cover, uri;
  int volume = -1;
  bool topology = false, transport = false, media = false, position = false;
  bool playing = false, tv = false;
  bool known() const { return topology && transport && media && position; }
};

struct Request {
  std::string host, service, action, arguments;
  int room = -1;
  std::string url() const {
    return host + (service == "ZoneGroupTopology" ? "/ZoneGroupTopology/Control" :
      service == "RenderingControl" ? "/MediaRenderer/RenderingControl/Control" : "/MediaRenderer/AVTransport/Control");
  }
  std::string soap_action() const { return "\"urn:schemas-upnp-org:service:" + service + ":1#" + action + "\""; }
  std::string body() const {
    return "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action +
      " xmlns:u=\"urn:schemas-upnp-org:service:" + service + ":1\">" + arguments + "</u:" + action + "></s:Body></s:Envelope>";
  }
};

class State {
 public:
  std::array<Room, 2> rooms;
  int selected = 0;
  bool command_failed = false;
  const Room &current() const { return rooms[selected]; }
  bool grouped() const { return rooms[0].topology && rooms[1].topology && rooms[0].coordinator == rooms[1].coordinator; }
  bool any_playing() const { return (rooms[0].known() && rooms[0].playing) || (rooms[1].known() && rooms[1].playing); }
  bool all_stopped() const { return rooms[0].known() && rooms[1].known() && !rooms[0].playing && !rooms[1].playing; }
  bool radio_confirmed() const { return grouped() && rooms[0].known() && rooms[1].known() && rooms[0].playing && rooms[1].playing && !rooms[0].tv; }
  bool has_request() const { return cursor_ < requests_.size(); }
  const Request &request() const { return requests_[cursor_]; }
  bool can_volume() const {
    return current().known() && current().volume >= 0 && (!grouped() || rooms[1 - selected].volume >= 0);
  }
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
    if (commanding_) { if (!ok) command_failed = true; ++cursor_; return; }
    if (ok && req.action == "GetZoneGroupState" && !topology_ok_) {
      topology_ok_ = parse_topology(xml.text("ZoneGroupState"));
    } else if (ok && req.room >= 0 && req.action != "GetZoneGroupState") {
      Room &r = pending_[req.room];
      if (req.action == "GetVolume") {
        const auto value = xml.text("CurrentVolume");
        if (!value.empty() && value.size() <= 3 && std::all_of(value.begin(), value.end(), [](char c) { return c >= '0' && c <= '9'; })) {
          int v = std::atoi(value.c_str()); if (v <= 100) r.volume = v;
        }
      } else if (req.action == "GetTransportInfo") {
        auto state = xml.text("CurrentTransportState");
        r.transport = state == "PLAYING" || state == "PAUSED_PLAYBACK" || state == "STOPPED" || state == "NO_MEDIA_PRESENT" || state == "TRANSITIONING";
        r.playing = state == "PLAYING";
      } else if (req.action == "GetMediaInfo") {
        r.media = xml.has("CurrentURI"); r.uri = xml.text("CurrentURI");
        r.tv = r.uri.rfind("x-sonos-htastream:", 0) == 0;
      } else if (req.action == "GetPositionInfo") {
        r.position = xml.has("TrackMetaData");
        Xml meta(xml.text("TrackMetaData"));
        r.title = meta.text("title"); r.artist = meta.text("creator");
        // Radio services often put artist/title in streamContent instead.
        auto stream = meta.text("streamContent");
        if (!stream.empty()) { r.artist = r.title; r.title = stream; }
        auto path = meta.text("albumArtURI");
        if (path.rfind("/", 0) == 0 && path.rfind("//", 0) != 0 && path.find("..") == std::string::npos)
          r.cover = r.coordinator_host + path;
        else if (origin(path) == r.coordinator_host) r.cover = path;
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
          for (const auto &action : {"GetTransportInfo", "GetMediaInfo", "GetPositionInfo"})
            requests_.push_back({r.coordinator_host, "AVTransport", action, "<InstanceID>0</InstanceID>", i});
        }
        requests_.push_back({r.host, "RenderingControl", "GetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel>", i});
      }
    }
  }
  void finish() {
    if (pending_[0].topology && pending_[1].topology && pending_[0].coordinator == pending_[1].coordinator) {
      auto identity = pending_[1]; pending_[1] = pending_[0];
      pending_[1].uuid = identity.uuid; pending_[1].host = identity.host; pending_[1].volume = identity.volume;
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
    if (action < 0 || action > 2 || captured_scope_.empty() || captured_scope_ != scope() || !current().known() ||
        (action == 0 ? current().tv : !can_volume())) return false;
    target_action_ = action; target_scope_ = scope(); target_room_ = selected;
    target_playing_ = !current().playing; target_volumes_ = {{-1, -1}};
    if (action == 0) requests_.push_back({current().coordinator_host, "AVTransport", target_playing_ ? "Play" : "Pause",
      std::string("<InstanceID>0</InstanceID>") + (target_playing_ ? "<Speed>1</Speed>" : ""), selected});
    else for (int i = 0; i < 2; ++i) if (i == selected || grouped()) {
      target_volumes_[i] = std::max(0, std::min(100, rooms[i].volume + (action == 1 ? -2 : 2)));
      requests_.push_back({rooms[i].host, "RenderingControl", "SetVolume", "<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>" +
        std::to_string(target_volumes_[i]) + "</DesiredVolume>", i});
    }
    return true;
  }
  bool command_confirmed() const {
    const auto &r = rooms[target_room_];
    if (!r.known() || target_scope_ != r.uuid + "|" + r.coordinator + "|" + r.members) return false;
    if (target_action_ == 0) return r.playing == target_playing_;
    for (int i = 0; i < 2; ++i) if (target_volumes_[i] >= 0 && rooms[i].volume != target_volumes_[i]) return false;
    return true;
  }

 private:
  std::array<Room, 2> pending_;
  std::vector<Request> requests_;
  size_t cursor_ = 0;
  bool topology_ok_ = false, manual_ = false, commanding_ = false, target_playing_ = false;
  int captured_room_ = 0, target_room_ = 0, target_action_ = 0;
  std::string captured_scope_, target_scope_;
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
