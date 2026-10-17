#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <iostream>
using namespace energydeck_sonos;
const std::string living = "http://192.168.0.190:1400", kitchen = "http://192.168.0.191:1400";
const std::string lid = "RINCON_542A1BE6F81C01400", kid = "RINCON_542A1BE6F89101400";
std::string escape(std::string s) {
  std::string result;
  for (char c : s) result += c == '&' ? "&amp;" : c == '<' ? "&lt;" : c == '>' ? "&gt;" : std::string(1,c);
  return result;
}
std::string response(const std::string &action, const std::string &body) {
  return "<s:Envelope><s:Body><u:" + action + "Response>" + body + "</u:" + action + "Response></s:Body></s:Envelope>";
}
std::string member(const std::string &id, const std::string &host, const std::string &name = "") {
  return "<ZoneGroupMember UUID=\"" + id + "\" ZoneName=\"" + xml_escape(name) + "\" Location=\"" + host + "/xml/device_description.xml\"/>";
}
std::string topology(bool grouped, bool living_leader = false, bool missing_living = false) {
  auto l = missing_living ? "" : member(lid, living), k = member(kid, kitchen);
  return "<ZoneGroups>" + (grouped ? "<ZoneGroup Coordinator=\"" + (living_leader ? lid : kid) + "\">" + l + k + "</ZoneGroup>" :
    "<ZoneGroup Coordinator=\"" + lid + "\">" + l + "</ZoneGroup><ZoneGroup Coordinator=\"" + kid + "\">" + k + "</ZoneGroup>") + "</ZoneGroups>";
}
struct Fixture {
  bool radio = false;
  bool grouped = true, living_leader = false, missing_living = false, all_fail = false;
  bool live[3] = {true,true,true}, tv[3] = {false,false,false}, fail[3] = {false,false,false};
  int volume[3] = {5,7,23};
  int mute[3] = {0,0,0};
  std::string title[3] = {"Living track","Kitchen track","Other track"};
  std::string actions = "Play,Pause,Next,Previous";
  std::string zones;
  std::string uri[3];
  int track[3] = {-1, -1, -1};
};
int poll_requests(State &s, const Fixture &f, const std::string &failed_once = "", int failure_status = 0) {
  int requests = 0; bool injected = false;
  while(s.has_request()) {
    assert(++requests < 40); // Three rooms, at most one bounded retry per read.
    const auto q = s.request(); int i = q.host == living ? 0 : q.host == kitchen ? 1 : 2;
    assert(q.action.rfind("Get",0) == 0); // Polling must never control playback.
    if (!injected && q.action == failed_once) {
      injected = true;
      s.accept(failure_status, failure_status == 200 ? "<s:Envelope><s:Body>" : "");
      continue;
    }
    if (f.all_fail || f.fail[i]) { s.accept(0,""); continue; }
    std::string body;
    if(q.action == "GetZoneGroupState") body = "<ZoneGroupState>" + escape(f.zones.empty() ? topology(f.grouped,f.living_leader,f.missing_living) : f.zones) + "</ZoneGroupState>";
    if(q.action == "GetTransportInfo") body = std::string("<CurrentTransportState>") + (f.live[i] ? "PLAYING" : "PAUSED_PLAYBACK") + "</CurrentTransportState>";
    if(q.action == "GetMediaInfo") body = std::string("<CurrentURI>") + (!f.uri[i].empty() ? escape(f.uri[i]) : f.tv[i] ? "x-sonos-htastream:RINCON_foo:spdif" : "x-rincon-queue:foo#0") + "</CurrentURI>";
    if(q.action == "GetPositionInfo") body = "<TrackMetaData>" + escape("<DIDL-Lite><item><dc:title>" + escape(f.title[i]) +
      "</dc:title><dc:creator>Artist &amp; guest</dc:creator><upnp:albumArtURI>/getaa?s=1&amp;u=track</upnp:albumArtURI></item></DIDL-Lite>") + "</TrackMetaData>";
    if (q.action == "GetPositionInfo" && f.track[i] >= 0) body += "<Track>" + std::to_string(f.track[i]) + "</Track>";
    if (f.radio && q.action == "GetMediaInfo") body += "<CurrentURIMetaData>" + escape("<item><title>Qmusic</title><albumArtURI>https://sali.sonos.superhi.fi/image?w=60&amp;image=logo.png</albumArtURI></item>") + "</CurrentURIMetaData>";
    if (f.radio && q.action == "GetPositionInfo") body = "<TrackMetaData>" + escape("<item><title>stream.mp3?secret=hidden</title><streamContent>Song - Artist</streamContent></item>") + "</TrackMetaData>";
    if(q.action == "GetVolume") body = "<CurrentVolume>" + std::to_string(f.volume[i]) + "</CurrentVolume>";
    if(q.action == "GetMute") body = "<CurrentMute>" + std::to_string(f.mute[i]) + "</CurrentMute>";
    if(q.action == "GetCurrentTransportActions") body = "<Actions>" + escape(f.actions) + "</Actions>";
    s.accept(200,response(q.action,body));
  }
  s.finish(); return requests;
}
int poll(State &s, const Fixture &f, const std::string &failed_once = "", int failure_status = 0) {
  s.begin(living,kitchen);
  return poll_requests(s, f, failed_once, failure_status);
}
void test_xml() {
  State follow; Fixture playback;
  poll(follow, playback);
  assert(follow.follow_compact_tab(0) == 1); // Also when already playing at boot.
  assert(follow.follow_compact_tab(2) == 2); // Preserve manual Climate selection.
  assert(!follow.playback_stopped());
  playback.all_fail = true; poll(follow, playback);
  assert(follow.follow_compact_tab(1) == 1); // Offline is not stopped.
  assert(!follow.playback_stopped());
  playback.all_fail = false; poll(follow, playback);
  assert(follow.follow_compact_tab(0) == 0); // Recovery is not a new start.
  playback.live[0] = playback.live[1] = false; poll(follow, playback);
  follow.rooms[0].transitioning = true;
  assert(!follow.playback_stopped());
  assert(follow.follow_compact_tab(1) == 1);
  follow.rooms[0].transitioning = false;
  assert(follow.playback_stopped());
  assert(follow.follow_compact_tab(1) == 0);
  assert(!follow.playback_stopped()); // Do not close a manually reopened idle page.
  playback.grouped = false; playback.live[1] = true; poll(follow, playback);
  assert(follow.follow_compact_tab(0) == 1); // Kitchen alone starts music.
  playback.live[1] = false; poll(follow, playback);
  assert(follow.follow_compact_tab(2) == 2); // Stopping does not replace Climate.
  assert(artwork_url("https://sali.sonos.superhi.fi/image?x=1", living) == "https://sali.sonos.superhi.fi/image?x=1");
  const std::string radionl = energydeck_artwork::RADIONL_COVER;
  for (auto path : {
    "https://sali.sonos.superhi.fi/image?image=https%3A%2F%2Fcdn-profiles.tunein.com%2Fs106736%2Fimages%2Flogog.jpg",
    "https://sali.sonos.radio/image?image=https://cdn-profiles.tunein.com/s106736/images/logod.jpg?t=1",
    "https://sali.sonos.radio/image?image=https%3a%2f%2fcdn-profiles.tunein.com%2fs106736%2fimages%2flogog.jpg",
    "https://cdn-profiles.tunein.com/s106736/images/logog.jpg",
    "/getaa?u=https%3A%2F%2Fcdn-profiles.tunein.com%2Fs106736%2Fimages%2Flogog.jpg"})
    assert(artwork_url(path, living) == radionl);
  assert(artwork_url("https://cdn-profiles.tunein.com/s307829/images/logoq.png?t=1694204996000", living) == "energydeck://artwork/joe-v1");
  for (auto path : {
    "https://evil.example/image?image=https://cdn-profiles.tunein.com/s106736/images/logog.jpg",
    "energydeck://artwork/unregistered",
    "energydeck://artwork/radionl-west-brabant-v1"}) assert(artwork_url(path, living).empty());
  for (auto path : {
    "https://sali.sonos.radio/image?image=https://cdn-profiles.tunein.com/s106737/images/logog.jpg",
    "https://sali.sonos.radio/image?image=https://cdn-profiles.tunein.com/s106736/images/logog.jpg.evil",
    "https://sali.sonos.radio/image?image=https://cdn-profiles.tunein.com/s106736/images/other.jpg",
    "https://sali.sonos.radio/image?image=https%3x%2F%2Fcdn-profiles.tunein.com%2Fs106736%2Fimages%2Flogog.jpg"})
    assert(artwork_url(path, living) == path);
  for (auto url : {"https://sali.sonos.superhi.fi.evil/image", "https://sali.sonos.radio@evil/image", "http://sali.sonos.radio/image", "//evil/image"}) assert(artwork_url(url, living).empty());
  // All registered logos work through both proxy families and coordinator
  // metadata, including the legacy CDN and small/medium/large PNG/JPEG URLs.
  auto encode_uri = [](const std::string &uri) {
    const char *hex = "0123456789ABCDEF";
    std::string encoded;
    for (unsigned char c : uri) { encoded += '%'; encoded += hex[c >> 4]; encoded += hex[c & 15]; }
    return encoded;
  };
  for (size_t index = 0; index < energydeck_artwork::STATION_COUNT; ++index) {
    const auto &station = energydeck_artwork::STATIONS[index];
    assert(energydeck_artwork::station_index(station.cover) == index);
    for (const char *scheme : {"http://", "https://"}) for (char size : {'g', 'd', 'q'}) {
      for (const char *extension : {".jpg", ".png"}) {
        for (const auto &resource : {
          std::string(scheme) + "cdn-profiles.tunein.com/" + station.tunein_id + "/images/logo" + size + extension,
          std::string(scheme) + "cdn-radiotime-logos.tunein.com/" + station.tunein_id + size + extension}) {
          for (const char *proxy : {"https://sali.sonos.radio/image?w=60&image=", "https://sali.sonos.superhi.fi/image?image="}) {
            const auto url = std::string(proxy) + resource + "?t=1&partnerId=tunein";
            assert(artwork_url(url, living) == station.cover);
            assert(artwork_url(std::string(proxy) + encode_uri(resource), living) == station.cover);
            assert(artwork_url(std::string(proxy) + resource + ".evil", living) == std::string(proxy) + resource + ".evil");
          }
          assert(artwork_url("/getaa?u=" + encode_uri(resource), living) == station.cover);
          assert(artwork_url(resource, living) == station.cover);
        }
      }
    }
  }
  assert(energydeck_artwork::station_index("energydeck://artwork/unregistered") == energydeck_artwork::STATION_COUNT);
  for (const char *foreign : {"s2398", "s98611", "s25741", "s109868", "s8585", "s346477", "s154463", "s210021"}) {
    const auto url = std::string("https://sali.sonos.radio/image?image=https://cdn-profiles.tunein.com/") + foreign + "/images/logog.png";
    assert(artwork_url(url, living) == url); // No regional, thematic or foreign substitutions.
  }
  State radio; Fixture fixture; fixture.radio = true; poll(radio, fixture);
  assert(radio.current().artist == "Qmusic" && radio.current().title == "Song - Artist");
  assert(radio.current().cover == "https://sali.sonos.superhi.fi/image?w=60&image=logo.png");
  fixture.radio = false; poll(radio, fixture);
  assert(radio.current().cover == kitchen + "/getaa?s=1&u=track");
  assert(unescape("A &amp; B &lt;3 &#233; &#x1F3B5;") == "A & B <3 é 🎵");
  assert(unescape("&amp;lt;") == "&lt;");
  assert(Xml("<root a='x&gt;y'><ns:title><![CDATA[A < B]]></ns:title></root>").text("title") == "A < B");
  assert(!Xml("<a><b></a>").valid);
  assert(!Xml("<a><b/>").valid);
  assert(!Xml("<!DOCTYPE a SYSTEM 'file:///etc/passwd'><a/>").valid);
  assert(!Xml(std::string(65537,'x')).valid);
  assert(origin(living + "/xml/device_description.xml") == living);
  for (auto url : {"http://evil:1400/x", "http://192.168.0.1.evil:1400/", "http://127.0.0.1:1400/", "http://192.168.0.999:1400/", "http://192.168.0.1:80/", "http://user@192.168.0.1:1400/", "https://192.168.0.1:1400/"}) assert(origin(url).empty());
}
void test_states() {
  State s; Fixture f;
  assert(poll(s,f) == 9);
  assert(s.grouped() && s.radio_confirmed());
  assert(s.rooms[0].title == "Kitchen track" && s.rooms[1].title == "Kitchen track");
  assert(s.rooms[0].volume == 5 && s.rooms[1].volume == 7);
  assert(s.current().cover == kitchen + "/getaa?s=1&u=track");
  f.living_leader = true; poll(s,f); assert(s.current().title == "Living track");
  f.grouped = false; f.tv[0] = true; poll(s,f);
  assert(!s.grouped() && s.selected == 1 && s.current().title == "Kitchen track");
  assert(s.rooms[0].title.empty() && s.rooms[0].cover.empty() && s.rooms[0].tv);
  s.switch_room(); poll(s,f); assert(s.selected == 0 && s.current().tv);
  s.capture(); poll(s,f); assert(!s.prepare_command(0));
  f.live[0] = false; poll(s,f); assert(s.selected == 1);
  f.live[0] = true; f.live[1] = false; poll(s,f); assert(s.selected == 0 && s.current().tv);
  f.live[0] = false; poll(s,f); assert(s.all_stopped() && !s.any_playing());
  f.all_fail = true; poll(s,f); assert(!s.all_stopped() && !s.current().known() && s.current().cover.empty());
  f.all_fail = false; f.missing_living = true; f.live[1] = true;
  poll(s,f); assert(s.selected == 1 && s.current().known() && s.can_volume());
  f.fail[0] = true; poll(s,f); assert(s.current().known());
  f.missing_living = false; f.fail[0] = false; f.grouped = true; f.living_leader = false;
  f.title[1] = "Björk & Beyoncé <live>"; poll(s,f); assert(s.current().title == f.title[1]);
}
void test_controls() {
  for (const auto &actions : {"Set, Stop, Pause, Play, X_DLNA_SeekTime, Next, Previous, X_DLNA_SeekTrackNr",
       "Play,Pause,Next,Previous", " \tNext \r\n, , Previous  ,"}) {
    State parsed; Fixture fixture; fixture.actions = actions;
    for (int action : {3, 4}) {
      poll(parsed, fixture); assert(parsed.current().next && parsed.current().previous);
      parsed.capture(); poll(parsed, fixture); assert(parsed.prepare_command(action));
      assert(parsed.request().host == kitchen);
      assert(parsed.request().action == (action == 3 ? "Previous" : "Next"));
    }
  }
  for (const auto &actions : {"Stop, Play", "NextTrack, X_DLNA_Previous", "", " , \t,"}) {
    State parsed; Fixture fixture; fixture.actions = actions;
    poll(parsed, fixture); assert(!parsed.current().next && !parsed.current().previous);
    parsed.capture(); assert(!parsed.prepare_command(3)); assert(!parsed.prepare_command(4));
  }
  State s; Fixture f; f.grouped = false; f.tv[0] = true;
  poll(s,f); assert(s.selected == 1);
  s.capture(); poll(s,f); assert(s.prepare_command(0));
  assert(s.request().host == kitchen && s.request().action == "Pause");
  s.accept(200,response("Pause","")); assert(!s.has_request() && !s.command_failed);
  f.live[1] = false; poll(s,f); assert(s.command_confirmed());
  s.rooms[1].transitioning = true;
  assert(!s.command_confirmed()); // A transition is not a confirmed pause.
  s.rooms[1].transitioning = false;
  f.live[1] = true; poll(s,f); s.capture(); poll(s,f); assert(s.prepare_command(2));
  assert(s.request().host == kitchen && s.request().arguments.find("<DesiredVolume>9</DesiredVolume>") != std::string::npos);
  s.accept(200,response("SetVolume","")); assert(!s.has_request());
  f.volume[1] = 9; poll(s,f); assert(s.command_confirmed());
  s.capture(); f.grouped = true; poll(s,f); assert(!s.prepare_command(2));
  s.capture(); poll(s,f); assert(s.prepare_command(1));
  assert(s.request().host == living); s.accept(200,response("SetVolume",""));
  assert(s.request().host == kitchen); s.accept(500,"<Fault/>"); assert(s.command_failed);
  for (int action : {1,2}) for (int v = 0; v <= 100; ++v) {
    const int step = action == 1 ? -2 : 2;
    f.volume[0] = v; f.volume[1] = 100-v; poll(s,f); s.capture(); poll(s,f); assert(s.prepare_command(action));
    assert(s.request().arguments.find("<DesiredVolume>" + std::to_string(std::max(0,std::min(100,v+step)))) != std::string::npos);
    s.accept(200,response("SetVolume",""));
    assert(s.request().arguments.find("<DesiredVolume>" + std::to_string(std::max(0,std::min(100,100-v+step)))) != std::string::npos);
  }
}

void test_read_recovery() {
  for (const auto &action : {"GetZoneGroupState", "GetTransportInfo", "GetMediaInfo",
      "GetPositionInfo", "GetCurrentTransportActions", "GetVolume", "GetMute"}) {
    for (int status : {0, 408, 429, 500, 502, 503, 504, 200}) {
      State s; Fixture f;
      assert(poll(s, f, action, status) == 10);
      assert(s.current().known() && s.can_volume() && s.can_mute());
      assert(s.current().title == "Kitchen track");
      assert(s.follow_compact_tab(0) == 1);
      assert(poll(s, f, action, status) == 10);
      assert(s.follow_compact_tab(2) == 2); // Recovery preserves a manual tab.
    }
  }
  State offline; Fixture f; f.all_fail = true;
  assert(poll(offline, f) == 4); // Two seeds, at most one retry each.
  assert(!offline.current().known() && !offline.can_volume());
  for (int status : {400, 401, 403, 404, 500}) {
    State rejected; rejected.begin(living, kitchen);
    rejected.accept(status, status == 500 ? response("GetZoneGroupState", "<Fault/>") : "");
    assert(rejected.request().host == kitchen); // Permanent failures skip retry.
  }
  State write; Fixture playing; poll(write, playing); write.capture();
  assert(write.prepare_command(0));
  write.accept(0, "");
  assert(write.command_failed && !write.has_request()); // Lost writes never repeat.
}

void test_system_inventory() {
  State s; s.begin(living, kitchen);
  const auto extra = "RINCON_OTHER";
  const auto zones = "<ZoneGroups><ZoneGroup Coordinator=\"" + lid + "\">" +
    member(lid, living, "Living & kitchen") + member(kid, kitchen, "Kitchen") +
    "<ZoneGroupMember UUID=\"hidden\" Invisible=\"1\" ZoneName=\"Kitchen\" Location=\"" + kitchen + "/xml/device_description.xml\"/>" +
    "</ZoneGroup><ZoneGroup Coordinator=\"" + extra + "\">" +
    member(extra, "http://192.168.0.192:1400", "Office") +
    member(extra, "http://192.168.0.192:1400", "Office") +
    member("invalid", "http://example.org:1400", "Unsafe") + "</ZoneGroup></ZoneGroups>";
  s.accept(200, response("GetZoneGroupState", "<ZoneGroupState>" + escape(zones) + "</ZoneGroupState>"));
  while (s.has_request()) {
    // Listing additional zones must not introduce reads or writes to those hosts.
    assert(s.request().host == living || s.request().host == kitchen);
    s.accept(404, "");
  }
  s.finish();
  assert(s.systems_known && s.systems.size() == 3);
  assert(!s.systems_complete); // An unsafe omitted zone disables grouping.
  assert(s.systems[0].name == "Kitchen" && s.systems[0].coordinator == lid);
  assert(s.systems[1].name == "Living & kitchen");
  assert(s.systems[2].name == "Office" && s.systems[2].coordinator == extra);
  Fixture offline; offline.all_fail = true; poll(s, offline);
  assert(!s.systems_known && s.systems.empty()); // Never list stale topology as current.
  Fixture recovered; poll(s, recovered);
  assert(s.systems_known && s.systems.size() == 2);
  assert(s.systems[0].name == s.systems[0].uuid); // Missing zone names have a safe fallback.
  std::string large = "<ZoneGroups><ZoneGroup Coordinator=\"" + lid + "\">" + member(lid, living) + member(kid, kitchen);
  for (int i = 0; i < 40; ++i) large += member("extra" + std::to_string(i), living, "Extra " + std::to_string(i));
  large += "</ZoneGroup></ZoneGroups>";
  s.begin(living, kitchen);
  s.accept(200, response("GetZoneGroupState", "<ZoneGroupState>" + escape(large) + "</ZoneGroupState>"));
  while (s.has_request()) s.accept(404, "");
  s.finish();
  assert(s.systems_known && s.systems.size() == 32 && !s.systems_complete); // Never group a truncated inventory.
}

const std::string oid = "RINCON_OFFICE", tid = "RINCON_STUDY";
const std::string office = "http://192.168.0.192:1400", study = "http://192.168.0.193:1400";
std::string zone_group(const std::string &leader, const std::vector<std::pair<std::string, std::string>> &members) {
  std::string xml = "<ZoneGroup Coordinator=\"" + leader + "\">";
  for (const auto &m : members) xml += member(m.first, m.second, m.first);
  return xml + "</ZoneGroup>";
}
std::string groups(const std::vector<std::string> &groups) {
  std::string xml = "<ZoneGroups>";
  for (const auto &g : groups) xml += g;
  return xml + "</ZoneGroups>";
}
void test_dashboard_room_follow() {
  Fixture f;
  f.zones = groups({zone_group(lid, {{lid,living}}), zone_group(kid, {{kid,kitchen}}),
    zone_group(tid, {{oid,office},{tid,study}})});
  f.live[0] = f.live[1] = false;
  State s; poll(s,f);
  RoomActivity activity;
  auto scan = [&](const std::string &extra_transport, int status = 200) {
    activity.begin(s);
    while (activity.has_request()) {
      const auto q = activity.request();
      assert(q.action == "GetTransportInfo" && q.host == study);
      activity.accept(status, response(q.action, "<CurrentTransportState>" + extra_transport + "</CurrentTransportState>"));
    }
    activity.finish();
  };
  scan("PLAYING");
  // Detail navigation must stay pinned, but activity outside the two seeds
  // still exposes the compact player rather than idle favorites.
  assert(!activity.follow_dashboard(s, false) && s.selected == 0);
  assert(s.any_playing() && !s.all_stopped());
  assert(s.follow_compact_tab(0) == 1);
  assert(activity.follow_dashboard(s, true));
  assert(s.current().uuid == oid && s.selected == 2 && !s.current().known());
  assert(!s.has_request()); // Automatic following is selection, never a write.
  s.begin_current();
  assert(s.request().host == study);
  assert(poll_requests(s,f) == 6); // Only the new room, no duplicate topology/default polls.
  assert(s.current().known() && s.current().title == "Other track" && s.current().volume == 23);
  assert(s.current().host == office && s.current().coordinator_host == study && !s.uses_pair_controls());
  assert(s.rooms[0].known() && !s.rooms[0].playing && s.systems.size() == 4);
  activity.begin(s); assert(!activity.has_request()); activity.finish();
  assert(!activity.follow_dashboard(s, true)); // Reuse the now-polled coordinator.
  assert(s.follow_compact_tab(2) == 2); // Manual Climate remains usable.
  f.live[0] = f.live[1] = true; poll(s,f);
  activity.begin(s); activity.finish();
  assert(!activity.follow_dashboard(s, true) && s.current().uuid == oid); // Several independent groups: no jumping.
  f.live[0] = f.live[1] = false; poll(s,f);

  // A follower selected in detail keeps its own volume and coordinator routing.
  assert(s.select_system(tid)); poll(s,f);
  activity.begin(s); activity.finish();
  assert(!activity.follow_dashboard(s, true) && s.current().uuid == tid);
  s.capture(); poll(s,f); assert(s.prepare_command(2));
  assert(s.request().host == study && s.request().action == "SetVolume");
  s.accept(200, response("SetVolume", ""));

  f.live[2] = false; f.live[1] = true; poll(s,f);
  activity.begin(s); activity.finish();
  assert(!activity.follow_dashboard(s, false) && s.current().uuid == tid);
  assert(activity.follow_dashboard(s, true) && s.current().uuid == kid);
  assert(s.current().known() && s.current().title == "Kitchen track");
  assert(s.follow_compact_tab(1) == 1); // Another playing room never emits a stop edge.
  assert(s.select_system(oid)); poll(s,f);
  // While a clicked control is pending, the same guard keeps its target intact.
  activity.begin(s); activity.finish();
  assert(!activity.follow_dashboard(s, false) && s.current().uuid == oid);

  f.live[1] = false; poll(s,f);
  activity.begin(s); activity.finish();
  assert(!activity.follow_dashboard(s, true) && s.all_stopped());
  assert(s.follow_compact_tab(1) == 0);
  s.set_system_activity(true, false); assert(s.follow_compact_tab(0) == 1);
  s.systems_complete = false;
  activity.follow_dashboard(s, true);
  assert(!s.all_stopped() && s.follow_compact_tab(1) == 1); // Incomplete discovery is not a stop.

  // An unselected offline/transitioning room cannot hide the card or be chosen.
  assert(s.select_system(lid)); f.fail[2] = true; poll(s,f);
  scan("", 0); assert(!activity.follow_dashboard(s, true));
  assert(!s.any_playing() && !s.all_stopped() && s.follow_compact_tab(1) == 1);
  scan("TRANSITIONING"); assert(!activity.follow_dashboard(s, true) && !s.all_stopped());
  scan("STOPPED"); assert(!activity.follow_dashboard(s, true) && s.all_stopped());
  assert(s.follow_compact_tab(1) == 0);
  scan("PLAYING"); assert(activity.follow_dashboard(s, true));
  s.begin_current(); assert(poll_requests(s,f) == 12); // One bounded retry per failed read.
  assert(!s.current().known() && !s.can_volume() && !s.can_mute());
}
void test_progressive_room_refresh() {
  Fixture f;
  f.zones = groups({zone_group(lid, {{lid,living}}), zone_group(kid, {{kid,kitchen}}),
    zone_group(oid, {{oid,office}})});
  State s;
  s.begin(living, kitchen);
  assert(!s.publish_discovery() && !s.systems_known);
  s.accept(200, response("GetZoneGroupState", "<ZoneGroupState>" + escape(f.zones) + "</ZoneGroupState>"));
  const auto next = s.request();
  assert(s.publish_discovery() && s.systems.size() == 3); // List is ready after one read.
  assert(s.select_system(oid) && !s.current().known());
  assert(s.request().action == next.action && s.request().host == next.host); // Queue remains immutable.
  // The scheduler drains its sent read, then abandons the remaining default reads.
  s.accept(200, response("GetTransportInfo", "<CurrentTransportState>PLAYING</CurrentTransportState>"));
  s.begin_current();
  assert(s.request().host == office && !s.publish_current());
  s.accept(200, response("GetTransportInfo", "<CurrentTransportState>PLAYING</CurrentTransportState>"));
  assert(!s.publish_current());
  s.accept(200, response("GetMediaInfo", "<CurrentURI>x-rincon-queue:office#0</CurrentURI>"));
  assert(!s.publish_current());
  s.accept(200, response("GetPositionInfo", "<TrackMetaData>" + escape("<item><title>Early office title</title></item>") + "</TrackMetaData>"));
  assert(s.publish_current() && s.current().known() && s.current().title == "Early office title");
  assert(s.has_request() && !s.can_volume()); // Optional controls still load safely.
  assert(s.select_system(kid) && !s.publish_current()); // Late office replies cannot publish over a newer click.
  assert(poll_requests(s,f) == 3);
  assert(s.current().uuid == kid && !s.current().known());
  assert(s.select_system(oid) && s.current().title == "Early office title");

  poll(s,f);
  assert(s.select_system(lid) && s.current().known());
  s.begin(living,kitchen);
  s.accept(200, response("GetZoneGroupState", "<ZoneGroupState>" + escape(f.zones) + "</ZoneGroupState>"));
  assert(s.publish_discovery() && s.current().known()); // Same discovery preserves the cached player.
  f.zones = groups({zone_group(kid, {{lid,living},{kid,kitchen}})});
  s.begin(living,kitchen);
  s.accept(200, response("GetZoneGroupState", "<ZoneGroupState>" + escape(f.zones) + "</ZoneGroupState>"));
  assert(s.publish_discovery() && !s.current().known() && !s.can_volume()); // Regrouping disables stale controls immediately.
  assert(!s.select_system(oid));
  poll_requests(s,f);
  assert(s.select_system(kid));
  s.begin_current();
  f.title[1] = "Fresh shared title";
  assert(poll_requests(s,f) == 6);
  assert(s.current().title == "Fresh shared title" && s.rooms[0].title == "Fresh shared title");
  assert(s.rooms[0].volume == f.volume[0] && s.rooms[1].volume == f.volume[1]);
}
void test_selection_during_poll() {
  Fixture f;
  f.zones = groups({zone_group(lid, {{lid,living}}), zone_group(kid, {{kid,kitchen}}),
    zone_group(oid, {{oid,office}}), zone_group(tid, {{tid,study}})});
  State s; poll(s,f);
  s.begin(living,kitchen);
  const auto first = s.request();
  assert(s.select_system(oid) && s.current().uuid == oid && !s.current().known());
  assert(s.request().host == first.host && s.request().action == first.action);
  poll_requests(s,f);
  assert(s.current().uuid == oid && !s.current().known()); // Old default poll cannot overwrite the click.

  s.begin_current();
  const auto office_read = s.request();
  assert(office_read.host == office);
  assert(s.select_system(tid)); assert(s.select_system(oid)); assert(s.select_system(tid));
  assert(s.current().uuid == tid && s.request().host == office_read.host);
  f.title[2] = "Office snapshot";
  assert(poll_requests(s,f) == 6);
  assert(s.current().uuid == tid && !s.current().known() && s.current().title.empty());
  assert(s.select_system(oid) && s.current().known() && s.current().title == "Office snapshot");

  assert(s.select_system(tid)); s.begin_current();
  assert(s.select_system(oid) && s.current().title == "Office snapshot");
  f.title[2] = "Study snapshot";
  assert(poll_requests(s,f) == 6);
  assert(s.current().uuid == oid && s.current().title == "Office snapshot");
  assert(s.select_system(tid) && s.current().known() && s.current().title == "Study snapshot");
  assert(s.current().host == study && s.current().coordinator_host == study);
  assert(s.select_system(lid)); assert(s.select_system(tid));
  assert(s.current().title == "Study snapshot"); // Previously visited rooms render without I/O.

  f.zones = groups({zone_group(lid, {{lid,living}}), zone_group(kid, {{kid,kitchen}}),
    zone_group(tid, {{oid,office},{tid,study}})});
  poll(s,f);
  assert(s.select_system(oid) && !s.current().known()); // Changed group invalidates its cached controls.
  assert(s.current().coordinator == tid && s.current().coordinator_host == study);
  s.capture(); poll(s,f); assert(s.prepare_command(2));
  assert(s.request().host == office && s.request().action == "SetVolume");
  s.accept(200, response("SetVolume", ""));
  assert(!s.has_request());
  f.fail[2] = true; s.begin_current(); poll_requests(s,f);
  assert(!s.current().known() && !s.can_volume() && !s.can_mute());
  assert(s.select_system(lid) && s.select_system(oid) && !s.current().known());
  f.fail[2] = false;
  f.zones = groups({zone_group(lid, {{lid,living}}), zone_group(kid, {{kid,kitchen}}), zone_group(tid, {{tid,study}})});
  poll(s,f);
  assert(!s.select_system(oid) && !s.current().known()); // Removed rooms cannot recover old cached data.
  assert(s.select_system(tid)); s.begin_current(); poll_requests(s,f);
  assert(s.current().known() && s.current().uuid == tid);
}
std::vector<Request> complete_writes(State &s) {
  std::vector<Request> writes;
  while (s.has_request()) {
    writes.push_back(s.request());
    const auto &q = writes.back();
    assert(q.action == "DelegateGroupCoordinationTo" || q.action == "BecomeCoordinatorOfStandaloneGroup" || q.action == "SetAVTransportURI");
    assert(q.service == "AVTransport"); // Grouping never sets volume, mute or starts playback.
    s.accept(200, response(q.action, ""));
  }
  return writes;
}
void test_room_selection() {
  Fixture f; f.zones = groups({zone_group(kid, {{lid,living},{kid,kitchen}}), zone_group(tid, {{oid,office},{tid,study}})});
  State s; poll(s,f);
  assert(!s.select_system("unknown"));
  assert(s.select_system(oid) && !s.has_request()); // Selecting is read-only.
  assert(s.selected == 2 && s.explicitly_selected() && !s.current().known());
  assert(poll(s,f) == 15); // Two coordinators, individual volume/mute for three rooms.
  assert(s.current().known() && s.current().uuid == oid && s.current().coordinator == tid);
  assert(s.current().host == office && s.current().coordinator_host == study);
  assert(s.current().title == "Other track" && s.current().volume == 23 && !s.uses_pair_controls());
  f.live[2] = false; poll(s,f);
  assert(s.selected == 2 && s.current().known() && !s.current().playing && s.current().title.empty());
  for (int action : {0,1,2,3,4,5}) {
    s.capture(); poll(s,f); assert(s.prepare_command(action));
    const auto q = s.request();
    assert(q.host == (action == 1 || action == 2 || action == 5 ? office : study));
    s.accept(200,response(q.action,"")); assert(!s.has_request());
  }
  s.capture(); poll(s,f); assert(s.prepare_command(2));
  s.accept(200,response("SetVolume","")); f.volume[2] = 25; poll(s,f);
  assert(s.command_confirmed() && s.rooms[0].volume == 5 && s.rooms[1].volume == 7);
  assert(s.can_favorite() && !s.has_request());
  // A selected speaker can supply discovery even if both default seeds fail.
  f.fail[0] = f.fail[1] = true; poll(s,f);
  assert(s.current().known() && s.can_favorite() && s.selected == 2);
  f.fail[0] = f.fail[1] = false;
  s.capture(); f.zones = groups({zone_group(kid, {{lid,living},{kid,kitchen}}), zone_group(oid, {{oid,office}}), zone_group(tid, {{tid,study}})});
  poll(s,f); assert(!s.prepare_command(0));
  assert(!s.has_request()); // External regrouping cancels captured commands.
  assert(s.select_system(kid)); poll(s,f);
  assert(s.selected == 1 && !s.uses_pair_controls());
  s.capture(); assert(s.prepare_command(5));
  assert(s.request().host == kitchen); s.accept(200,response("SetMute","")); assert(!s.has_request());
  f.all_fail = true; poll(s,f);
  assert(s.selected == 1 && !s.can_favorite() && !s.current().known());
}
void test_group_editing() {
  Fixture f;
  f.zones = groups({zone_group(kid, {{lid,living},{kid,kitchen}}), zone_group(tid, {{oid,office},{tid,study}})});
  State automatic; poll(automatic,f); automatic.sync_group_edit();
  assert(!automatic.explicitly_selected() && automatic.toggle_group(oid));
  assert(automatic.explicitly_selected());
  f.live[0] = f.live[1] = false; poll(automatic,f);
  assert(automatic.selected == 0 && automatic.group_edit_valid());
  f.live[0] = f.live[1] = true;
  State extra; poll(extra,f); assert(extra.select_system(oid)); poll(extra,f); extra.sync_group_edit();
  assert(extra.toggle_group(kid) && extra.prepare_group());
  auto promoted = complete_writes(extra);
  assert(promoted.size() == 3 && promoted[0].host == study && promoted[0].action == "DelegateGroupCoordinationTo");
  assert(promoted[0].arguments.find("<NewCoordinator>" + oid + "</NewCoordinator>") != std::string::npos);
  assert(promoted[1].host == kitchen && promoted[1].action == "DelegateGroupCoordinationTo");
  assert(promoted[2].host == kitchen && promoted[2].arguments.find("x-rincon:" + oid) != std::string::npos);
  State s; poll(s,f); assert(s.select_system(lid)); poll(s,f); s.sync_group_edit();
  assert(s.group_edit_valid() && !s.group_dirty() && s.group_checked(lid) && s.group_checked(kid));
  assert(!s.toggle_group(lid) && !s.toggle_group("unknown"));
  assert(s.toggle_group(oid) && s.group_dirty() && !s.has_request());
  assert(s.toggle_group(oid) && !s.group_dirty() && !s.prepare_group());
  assert(s.toggle_group(kid) && s.toggle_group(oid));
  poll(s,f); assert(s.prepare_group());
  const auto writes = complete_writes(s);
  assert(writes.size() == 3);
  assert(writes[0].action == "DelegateGroupCoordinationTo" && writes[0].host == kitchen);
  assert(writes[0].arguments.find("<NewCoordinator>" + lid + "</NewCoordinator>") != std::string::npos);
  assert(writes[0].arguments.find("<RejoinGroup>1</RejoinGroup><ClearSource>0</ClearSource>") != std::string::npos);
  assert(writes[1].action == "BecomeCoordinatorOfStandaloneGroup" && writes[1].host == kitchen);
  assert(writes[2].host == office && writes[2].arguments.find("x-rincon:" + lid) != std::string::npos);
  assert(!s.group_confirmed()); // SOAP acknowledgements do not prove topology changed.
  f.zones = groups({zone_group(lid, {{lid,living},{oid,office}}),zone_group(kid,{{kid,kitchen}}),zone_group(tid,{{tid,study}})});
  poll(s,f); assert(s.group_confirmed()); s.reset_group_edit();
  s.systems.push_back({"new", "New", lid, living, living, "new;"});
  assert(!s.group_confirmed()); s.systems.pop_back();
  assert(!s.group_dirty() && s.group_edit_valid() && s.group_checked(oid) && !s.group_checked(kid));
  assert(s.toggle_group(kid));
  f.zones = groups({zone_group(lid,{{lid,living}}),zone_group(kid,{{kid,kitchen},{oid,office}}),zone_group(tid,{{tid,study}})});
  poll(s,f); assert(!s.group_edit_valid() && !s.toggle_group(tid) && !s.prepare_group() && !s.has_request());
  s.reset_group_edit(); assert(s.group_edit_valid() && !s.group_dirty());
  s.systems_complete = false; assert(!s.toggle_group(oid) && !s.prepare_group());
  // Moving another group's leader must preserve its unselected followers.
  f.zones = groups({zone_group(lid,{{lid,living}}),zone_group(kid,{{kid,kitchen}}),zone_group(tid,{{oid,office},{tid,study}})});
  poll(s,f); s.reset_group_edit(); assert(s.toggle_group(tid) && s.prepare_group());
  auto moved = complete_writes(s);
  assert(moved.size() == 2 && moved[0].action == "DelegateGroupCoordinationTo" && moved[0].host == study);
  assert(moved[0].arguments.find("<NewCoordinator>" + oid + "</NewCoordinator>") != std::string::npos);
  assert(moved[1].host == study && moved[1].action == "SetAVTransportURI");
  f.zones = groups({zone_group(lid,{{lid,living},{tid,study}}),zone_group(kid,{{kid,kitchen}}),zone_group(oid,{{oid,office}})});
  poll(s,f); assert(s.group_confirmed());
  // Moving the entire other group joins followers before the old leader.
  f.zones = groups({zone_group(lid,{{lid,living}}),zone_group(kid,{{kid,kitchen}}),zone_group(tid,{{oid,office},{tid,study}})});
  poll(s,f); s.reset_group_edit(); assert(s.toggle_group(oid) && s.toggle_group(tid) && s.prepare_group());
  moved = complete_writes(s);
  assert(moved.size() == 2 && moved[0].host == office && moved[1].host == study);
  s.reset_group_edit(); assert(s.toggle_group(oid) && s.prepare_group());
  s.accept(0, ""); assert(s.command_failed && !s.has_request());
  f.zones = groups({zone_group(lid,{{lid,living},{oid,office}}),zone_group(kid,{{kid,kitchen}}),zone_group(tid,{{tid,study}})});
  poll(s,f); assert(!s.group_confirmed()); // A lost write reply is never retried or called successful.
}

Favorite favorite(bool radio = false, std::string id = "FV:2/1") {
  const std::string cls = radio ? "object.item.audioItem.audioBroadcast" : "object.container.playlistContainer";
  return {id, "Rock & Soul", radio ? "x-sonosapi-stream:radio?sid=1&flags=2" : "x-rincon-cpcontainer:playlist?sid=9&flags=2",
    "<DIDL-Lite><item><upnp:class>" + cls + "</upnp:class><dc:title>Rock &amp; Soul</dc:title></item></DIDL-Lite>", radio, ""};
}
std::string favorite_page(const std::vector<Favorite> &items, int total, std::string version = "1") {
  std::string didl = "<DIDL-Lite>";
  for (const auto &f : items) didl += "<item id=\"" + f.id + "\"><dc:title>" + escape(f.title) + "</dc:title><res>" + escape(f.uri) +
    "</res><upnp:albumArtURI>" + escape(f.cover) + "</upnp:albumArtURI><r:resMD>" + escape(f.metadata) + "</r:resMD></item>";
  didl += "</DIDL-Lite>";
  return response("Browse", "<Result>" + escape(didl) + "</Result><NumberReturned>" + std::to_string(items.size()) +
    "</NumberReturned><TotalMatches>" + std::to_string(total) + "</TotalMatches><UpdateID>" + version + "</UpdateID>");
}
void accept_favorite_read(State &s, const Request &q, const Favorite &favorite, int track = 17) {
  assert(q.action.rfind("Get", 0) == 0 && s.request_delay_ms() == 200);
  if (q.action == "GetMediaInfo") {
    const auto uri = favorite.radio ? favorite.uri : "x-rincon-queue:" + s.current().coordinator + "#0";
    s.accept(200, response(q.action, "<CurrentURI>" + escape(uri) + "</CurrentURI>"));
  } else if (q.action == "GetTransportInfo")
    s.accept(200, response(q.action, "<CurrentTransportState>STOPPED</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus>"));
  else {
    assert(q.action == "GetPositionInfo");
    s.accept(200, response(q.action, "<Track>" + std::to_string(track) + "</Track>"));
  }
}
void settle_favorite_source(State &s, const Favorite &favorite) {
  assert(s.request().action == "GetMediaInfo"); accept_favorite_read(s, s.request(), favorite);
  assert(s.request().action == "GetTransportInfo"); accept_favorite_read(s, s.request(), favorite);
}
void test_favorites() {
  {
    Favorites covers; auto item = favorite(); item.cover = "https://i.scdn.co/image/abc";
    covers.begin(kitchen); covers.accept(200, favorite_page({item}, 1));
    assert(covers.items[0].cover == item.cover);
    const auto signature = covers.display_signature();
    covers.items[0].metadata += " "; assert(covers.display_signature() == signature);
    covers.items[0].title += " changed"; assert(covers.display_signature() != signature);
    item.cover = "https://i.scdn.co.evil/image/abc";
    covers.begin(kitchen); covers.accept(200, favorite_page({item}, 1));
    assert(covers.items[0].cover.empty());
    item.cover = "https://sali.sonos.radio/image?image=https%3A%2F%2Fcdn-profiles.tunein.com%2Fs106736%2Fimages%2Flogog.jpg";
    covers.begin(kitchen); covers.accept(200, favorite_page({item}, 1));
    assert(covers.items[0].cover == energydeck_artwork::RADIONL_COVER);
    for (const auto &station : energydeck_artwork::STATIONS) {
      item.cover = std::string("https://sali.sonos.radio/image?w=60&image=https://cdn-profiles.tunein.com/") + station.tunein_id + "/images/logoq.png?t=1&partnerId=tunein";
      covers.begin(kitchen); covers.accept(200, favorite_page({item}, 1));
      assert(covers.items.size() == 1 && covers.items[0].cover == station.cover);
    }
    item.cover.clear();
    item.metadata = "<item><class>object.container.playlistContainer</class><albumArtURI>https://image-cdn-ak.spotifycdn.com/image/test</albumArtURI></item>";
    covers.begin(kitchen); covers.accept(200, favorite_page({item}, 1));
    assert(covers.items[0].cover == "https://image-cdn-ak.spotifycdn.com/image/test");
  }
  Favorites f; auto music = favorite(), radio = favorite(true,"FV:2/2"), pinned = favorite(false,"FV:2/3"); pinned.uri.clear();
  f.begin(kitchen); assert(f.request().action == "Browse" && f.request().url() == kitchen + "/MediaServer/ContentDirectory/Control");
  f.accept(200,favorite_page({music,radio,pinned},3));
  assert(f.known && !f.failed && !f.has_request() && f.items.size() == 2);
  assert(f.items[0].title == music.title && f.items[0].metadata == music.metadata && !f.items[0].radio && f.items[1].radio);
  std::vector<Favorite> first;
  for (int i=0;i<8;++i) first.push_back(favorite(false,"FV:2/" + std::to_string(i)));
  f.begin(living); f.accept(200,favorite_page(first,9));
  assert(!f.known && f.has_request() && f.request().arguments.find("<StartingIndex>8</StartingIndex>") != std::string::npos);
  f.accept(200,favorite_page({favorite(false,"FV:2/8")},9)); assert(f.known && f.items.size() == 9);
  f.begin(living); f.accept(200,favorite_page(first,9)); f.accept(200,favorite_page({music},9,"2"));
  assert(f.failed && !f.known && !f.has_request()); // Never combine different list versions.
  f.begin(living); f.accept(200,favorite_page({},0)); assert(f.known && f.items.empty());
  f.begin(living); f.accept(200,favorite_page({},4)); assert(f.failed); // No infinite pagination.
  f.begin(living); f.accept(200,favorite_page({music,music},2)); assert(f.failed); // Duplicate IDs.
  f.begin(living); f.accept(200,"<broken>"); assert(f.failed);
  f.begin(living); f.accept(500,"<Fault/>"); assert(f.failed);
  f.begin(living); f.accept(200,favorite_page(first,101)); assert(f.failed);

  State s; Fixture fixture; fixture.grouped = false; fixture.tv[0] = true; poll(s,fixture);
  s.capture(); poll(s,fixture); assert(s.prepare_favorite(radio));
  assert(s.request().action == "SetAVTransportURI" && s.request().host == kitchen);
  assert(s.request_timeout_ms() == 30000);
  assert(s.request().arguments.find("sid=1&amp;flags=2") != std::string::npos);
  s.accept(200,response("SetAVTransportURI","")); settle_favorite_source(s, radio);
  assert(s.request().action == "Play");
  assert(s.request_timeout_ms() == 8000);
  s.accept(200,response("Play","")); assert(!s.has_request() && !s.command_failed);
  assert(!s.command_confirmed()); // Old playing track is not confirmation.
  s.rooms[1].uri = radio.uri; assert(s.command_confirmed());
  s.capture(); poll(s,fixture); assert(s.prepare_favorite(music));
  assert(s.request().action == "AddURIToQueue" && s.request().arguments.find("<EnqueueAsNext>0</EnqueueAsNext>") != std::string::npos);
  assert(s.request_timeout_ms() == 30000);
  s.accept(200,response("AddURIToQueue","<FirstTrackNumberEnqueued>17</FirstTrackNumberEnqueued><NumTracksAdded>20</NumTracksAdded>"));
  assert(s.request().action == "SetAVTransportURI"); s.accept(200,response("SetAVTransportURI",""));
  assert(s.request_timeout_ms() == 1500);
  settle_favorite_source(s, music);
  assert(s.request().action == "Seek" && s.request().arguments.find("<Target>17</Target>") != std::string::npos);
  assert(s.request_timeout_ms() == 8000);
  s.accept(200,response("Seek",""));
  assert(s.request().action == "GetPositionInfo"); accept_favorite_read(s, s.request(), music);
  assert(s.request().action == "Play"); s.accept(200,response("Play",""));
  assert(!s.has_request()); s.rooms[1].uri = "x-rincon-queue:" + kid + "#0"; s.rooms[1].track = 17; assert(s.command_confirmed());
  for (int failure : {0,500}) {
    s.capture(); poll(s,fixture); assert(s.prepare_favorite(music)); s.accept(failure,"<Fault/>");
    assert(s.command_failed && !s.has_request()); // A failed enqueue must not start an old queue.
  }
  s.capture(); poll(s,fixture); assert(s.prepare_favorite(music));
  s.accept(200,response("AddURIToQueue","<FirstTrackNumberEnqueued>0</FirstTrackNumberEnqueued><NumTracksAdded>0</NumTracksAdded>"));
  assert(s.command_failed && !s.has_request());
  s.capture(); fixture.grouped = true; poll(s,fixture); assert(!s.prepare_favorite(music));
  s.capture(); poll(s,fixture); assert(s.prepare_favorite(radio));
  s.accept(500,"<Fault/>"); assert(!s.has_request()); // No Play after failed SetURI.
  s.capture(); poll(s,fixture); assert(s.prepare_command(5));
  assert(s.request().action == "SetMute" && s.request().host == living);
  s.accept(200,response("SetMute","")); assert(s.request().host == kitchen);
  s.accept(200,response("SetMute","")); s.rooms[0].mute = s.rooms[1].mute = 1; assert(s.command_confirmed());
  s.capture(); poll(s,fixture); assert(s.prepare_command(4)); assert(s.request().action == "Next");
  s.accept(200,response("Next","")); assert(!s.command_confirmed()); s.rooms[s.selected].track_uri = "new-track"; assert(s.command_confirmed());

  State chosen; Fixture household;
  household.zones = groups({zone_group(lid,{{lid,living}}),zone_group(kid,{{kid,kitchen}}),zone_group(tid,{{oid,office},{tid,study}})});
  poll(chosen,household); assert(chosen.select_system(oid)); poll(chosen,household);
  for (const auto &item : {radio, music}) {
    chosen.capture(); poll(chosen,household);
    assert(chosen.can_favorite() && chosen.prepare_favorite(item));
    std::vector<std::string> actions;
    while (chosen.has_request()) {
      const auto q = chosen.request();
      assert(q.host == study && q.room == 2 && q.service == "AVTransport");
      if (q.action.rfind("Get", 0) == 0) { accept_favorite_read(chosen, q, item); continue; }
      actions.push_back(q.action);
      if (q.action == "AddURIToQueue") chosen.accept(200,response(q.action,"<FirstTrackNumberEnqueued>17</FirstTrackNumberEnqueued><NumTracksAdded>20</NumTracksAdded>"));
      else {
        if (!item.radio && q.action == "SetAVTransportURI") assert(q.arguments.find("x-rincon-queue:" + tid + "#0") != std::string::npos);
        chosen.accept(200,response(q.action,""));
      }
    }
    assert(actions == (item.radio ? std::vector<std::string>{"SetAVTransportURI", "Play"} :
      std::vector<std::string>{"AddURIToQueue", "SetAVTransportURI", "Seek", "Play"}));
    assert(chosen.current().volume == 23 && chosen.current().mute == 0);
    assert(chosen.rooms[0].volume == 5 && chosen.rooms[1].volume == 7);
  }
}
void test_favorite_readiness() {
  State s; Fixture f; auto radio = favorite(true), playlist = favorite();
  poll(s, f); s.capture(); assert(s.prepare_favorite(radio));
  s.accept(200, response("SetAVTransportURI", ""));
  for (int i = 0; i < 2; ++i) {
    s.accept(200, response("GetMediaInfo", "<CurrentURI>old-source</CurrentURI>"));
    assert(s.has_request() && s.request().action == "GetMediaInfo" && !s.command_failed);
  }
  accept_favorite_read(s, s.request(), radio);
  s.accept(0, ""); // Retry a lost readiness read, never its successful preceding write.
  assert(s.request().action == "GetTransportInfo");
  s.accept(200, response("GetTransportInfo", "<CurrentTransportState>TRANSITIONING</CurrentTransportState>"));
  assert(s.request().action == "GetTransportInfo" && s.request_delay_ms() == 200);
  accept_favorite_read(s, s.request(), radio);
  assert(s.request().action == "Play" && s.request_delay_ms() == 10);
  s.accept(500, "<s:Envelope><s:Body><s:Fault><errorCode>701</errorCode></s:Fault></s:Body></s:Envelope>");
  assert(s.command_failed && s.command_error == 701 && !s.has_request());

  // Radio source never settles: bounded read-only checks, no Play of the old station.
  poll(s, f); s.capture(); assert(s.prepare_favorite(radio)); s.accept(200, response("SetAVTransportURI", ""));
  for (unsigned i = 0; i < State::MAX_FAVORITE_SETTLE_READS; ++i) {
    assert(s.request().action == "GetMediaInfo");
    s.accept(200, response("GetMediaInfo", "<CurrentURI>old-source</CurrentURI>"));
  }
  assert(s.command_failed && s.command_error == -1 && !s.has_request());
  poll(s, f); s.capture(); assert(s.prepare_favorite(radio)); s.accept(0, "");
  assert(s.command_failed && !s.has_request()); // Lost SetURI never causes a retry or Play.
  f.uri[1] = radio.uri; poll(s, f);
  assert(s.command_confirmed()); // Fresh actual playback resolves an ambiguous acknowledgement.
  f.uri[1] = "other-station"; poll(s, f); assert(!s.command_confirmed());
  f.uri[1].clear();

  poll(s, f); s.capture(); assert(s.prepare_favorite(playlist));
  s.accept(200, response("AddURIToQueue", "<FirstTrackNumberEnqueued>17</FirstTrackNumberEnqueued><NumTracksAdded>3</NumTracksAdded>"));
  s.accept(200, response("SetAVTransportURI", "")); settle_favorite_source(s, playlist);
  assert(s.request().action == "Seek"); s.accept(200, response("Seek", ""));
  s.accept(200, response("GetPositionInfo", "<Track>2</Track>"));
  assert(s.request().action == "GetPositionInfo"); // Do not play an old queue position.
  accept_favorite_read(s, s.request(), playlist);
  assert(s.request().action == "Play"); s.accept(200, response("Play", ""));
  s.rooms[s.selected].uri = "x-rincon-queue:" + s.current().coordinator + "#0";
  for (int track : {17, 18, 19}) { s.rooms[s.selected].track = track; assert(s.command_confirmed()); }
  for (int track : {-1, 16, 20}) { s.rooms[s.selected].track = track; assert(!s.command_confirmed()); }
  f.grouped = false; poll(s, f); s.capture(); assert(s.prepare_favorite(radio));
  while (s.has_request()) {
    const auto q = s.request();
    if (q.action.rfind("Get", 0) == 0) accept_favorite_read(s, q, radio);
    else s.accept(200, response(q.action, ""));
  }
  poll(s, f); s.reset_group_edit(); assert(s.toggle_group(kid) && s.prepare_group());
  while (s.has_request()) {
    const auto q = s.request();
    assert(q.action.rfind("Get", 0) != 0 && s.request_delay_ms() == 10 && s.request_timeout_ms() == 8000);
    s.accept(200, response(q.action, ""));
  }
  assert(!s.command_failed); // Group SetURI does not inherit prior favorite readiness.

}
void test_radio_source_normalization() {
  const std::string expected = "x-sonosapi-stream:tunein%3As123?sid=303&flags=8296&sn=8";
  const std::string normalized = "x-sonosapi-stream:tunein%3as123?sid=303&flags=8232&sn=8";
  assert(favorite_source_matches(expected, normalized));
  assert(!favorite_source_matches(expected, ""));
  for (const auto &other : {
    "x-sonosapi-stream:tunein%3as999?sid=303&flags=8232&sn=8",
    "x-sonosapi-stream:tunein%3as123?sid=304&flags=8232&sn=8",
    "x-sonosapi-stream:tunein%3as123?sid=303&flags=8232&sn=9",
    "x-sonosapi-stream:tunein%3as123?sid=303&flags=8233&sn=8",
    "x-sonosapi-stream:tunein%3as123?sid=303&flags=bad&sn=8",
    "x-sonosapi-stream:tunein%3as123?sid=303&flags=8232&flags=8232&sn=8",
    "x-sonosapi-stream:tunein%3xs123?sid=303&flags=8232&sn=8",
    "x-sonosapi-stream:tunein%3as123?sid=303&flags=8232&sn=8&extra=1",
    "x-rincon-queue:coordinator#0"}) assert(!favorite_source_matches(expected, other));
  assert(!favorite_source_matches("x-rincon-queue:a#0", "x-rincon-queue:b#0"));
  assert(!favorite_source_matches("https://radio.example/a%3A?flags=8296", "https://radio.example/a%3a?flags=8232"));

  State s; Fixture f; auto radio = favorite(true); radio.uri = expected;
  poll(s, f); s.capture(); assert(s.prepare_favorite(radio));
  s.accept(200, response("SetAVTransportURI", ""));
  s.accept(200, response("GetMediaInfo", "<CurrentURI>" + escape(normalized) + "</CurrentURI>"));
  assert(s.request().action == "GetTransportInfo" && !s.command_failed);
  accept_favorite_read(s, s.request(), radio);
  assert(s.request().action == "Play"); s.accept(200, response("Play", ""));
  f.uri[1] = normalized; poll(s, f); assert(s.command_confirmed());
  s.rooms[s.selected].transport_error = true; assert(!s.command_confirmed());
  f.live[0] = f.live[1] = false; poll(s, f); assert(!s.command_confirmed());
  s.capture(); assert(s.prepare_favorite(radio));
  assert(s.request().action == "GetMediaInfo");
  s.accept(200, response("GetMediaInfo", "<CurrentURI>" + escape(normalized) + "</CurrentURI>"));
  accept_favorite_read(s, s.request(), radio);
  assert(s.request().action == "Play"); s.accept(200, response("Play", ""));
  assert(!s.has_request() && !s.command_failed); // Reuse the loaded radio; no second SetURI.
  for (bool transitioning : {false, true}) {
    poll(s, f);
    s.rooms[s.selected].transport_error = !transitioning;
    s.rooms[s.selected].transitioning = transitioning;
    s.capture(); assert(s.prepare_favorite(radio));
    assert(s.request().action == "SetAVTransportURI"); // An errored/transitioning source needs a load.
  }
}
void test_favorite_preserves_rooms() {
  // Cover both default selection (no click) and explicitly selected rooms.
  for (bool grouped : {false, true}) for (int choice : {-1, 0, 1})
    for (int offline : {-1, 0, 1, 2}) for (bool radio : {false, true}) {
      State s; Fixture f; f.grouped = grouped; f.mute[0] = f.mute[1] = 1;
      poll(s, f);
      if (choice >= 0) assert(s.select_system(choice == 0 ? lid : kid));
      f.fail[0] = offline == 0 || offline == 2;
      f.fail[1] = offline == 1 || offline == 2;
      poll(s, f);
      const bool known = s.current().known();
      assert(s.can_favorite() == known);
      const auto selected = s.selected;
      const auto coordinator = s.current().coordinator_host;
      const auto scope = s.scope();
      const auto volumes = std::array<int, 2>{{s.rooms[0].volume, s.rooms[1].volume}};
      const auto mutes = std::array<int, 2>{{s.rooms[0].mute, s.rooms[1].mute}};
      s.capture(); poll(s, f);
      assert(s.prepare_favorite(favorite(radio)) == known);
      std::vector<std::string> actions;
      while (s.has_request()) {
        const auto q = s.request();
        assert(q.room == selected && q.host == coordinator && q.service == "AVTransport");
        if (q.action.rfind("Get", 0) == 0) { accept_favorite_read(s, q, favorite(radio)); continue; }
        actions.push_back(q.action);
        assert(q.arguments.find("<CurrentURI>x-rincon:") == std::string::npos);
        if (q.action == "AddURIToQueue")
          s.accept(200, response(q.action, "<FirstTrackNumberEnqueued>17</FirstTrackNumberEnqueued><NumTracksAdded>1</NumTracksAdded>"));
        else s.accept(200, response(q.action, ""));
      }
      const auto expected = radio ? std::vector<std::string>{"SetAVTransportURI", "Play"} :
        std::vector<std::string>{"AddURIToQueue", "SetAVTransportURI", "Seek", "Play"};
      assert(actions == (known ? expected : std::vector<std::string>{}));
      assert(s.selected == selected && s.scope() == scope);
      for (int i = 0; i < 2; ++i) assert(s.rooms[i].volume == volumes[i] && s.rooms[i].mute == mutes[i]);
    }
  State s; Fixture f; f.grouped = false; poll(s, f);
  s.capture(); f.grouped = true; poll(s, f);
  assert(!s.prepare_favorite(favorite(true)) && !s.has_request()); // Stale scope must never play in a new group.
}
int main(int argc, char **argv) {
  test_favorite_preserves_rooms();
  if(argc > 1 && std::string(argv[1]) == "--favorites-probe") {
    Favorites f; f.begin(kitchen);
    while(f.has_request()) {
      const auto q=f.request();
      std::cout << q.action << '\t' << q.url() << '\t' << q.soap_action() << '\t' << q.body() << std::endl;
      std::string status,body; if(!std::getline(std::cin,status) || !std::getline(std::cin,body)) return 2;
      f.accept(std::atoi(status.c_str()),body);
    }
    std::cout << "RESULT favorites=" << f.items.size() << " known=" << f.known << std::endl;
    for(const auto &item:f.items) std::cout << "FAVORITE " << (item.radio ? "radio: " : "music: ") << item.title << std::endl;
    return f.known ? 0 : 1;
  }
  // This probe path never calls prepare_command and cannot create writes.
  if(argc > 1 && std::string(argv[1]) == "--probe") {
    State s; s.begin(living,kitchen);
    while(s.has_request()) {
      const auto q=s.request();
      std::cout << q.action << '\t' << q.url() << '\t' << q.soap_action() << '\t' << q.body() << std::endl;
      std::string status,body; if(!std::getline(std::cin,status) || !std::getline(std::cin,body)) return 2;
      s.accept(std::atoi(status.c_str()),body);
    }
    s.finish();
    std::cout << "RESULT selected=" << s.selected << " grouped=" << s.grouped() << std::endl;
    for(const auto &r:s.rooms) std::cout << "ROOM known=" << r.known() << " playing=" << r.playing << " tv=" << r.tv << " volume=" << r.volume << " title=" << r.title << " artist=" << r.artist << " cover=" << r.cover << std::endl;
    return 0;
  }
  test_xml(); test_states(); test_controls(); test_read_recovery(); test_system_inventory(); test_room_selection(); test_dashboard_room_follow(); test_selection_during_poll(); test_progressive_room_refresh(); test_group_editing(); test_favorites(); test_favorite_readiness(); test_radio_source_normalization();
  std::cout << "PASS: favorites preserve default/explicit rooms, existing groups, volume and mute; offline/stale scopes abort" << std::endl;
  std::cout << "PASS: favorites wait for source/transport/seek readiness, bound read retries, never retry writes and confirm the added track range or fresh playback after a lost acknowledgement" << std::endl;
  std::cout << "PASS: radio readiness/playback accept observed Sonos URI normalization and reject other stations, services, accounts and unrelated flag changes" << std::endl;
  std::cout << "PASS: paged favorites, filtering, XML escaping, direct radio, queue append/seek, failed-command abort, mute and skip" << std::endl;
  std::cout << "PASS: Sonos XML, topology/coordinator, visible system inventory, explicit room selection and grouping, solo/group, music/TV priority, selection, offline, artwork and scoped controls" << std::endl;
  std::cout << "PASS: all-room dashboard following, stable targets, detail/control guards, selected-room-only reads and unknown playback edges" << std::endl;
  std::cout << "PASS: immediate selection during reads, progressive discovery/player publication, UUID cache invalidation and fresh grouped-follower snapshots" << std::endl;
}
