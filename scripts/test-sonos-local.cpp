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
std::string member(const std::string &id, const std::string &host) {
  return "<ZoneGroupMember UUID=\"" + id + "\" Location=\"" + host + "/xml/device_description.xml\"/>";
}
std::string topology(bool grouped, bool living_leader = false, bool missing_living = false) {
  auto l = missing_living ? "" : member(lid, living), k = member(kid, kitchen);
  return "<ZoneGroups>" + (grouped ? "<ZoneGroup Coordinator=\"" + (living_leader ? lid : kid) + "\">" + l + k + "</ZoneGroup>" :
    "<ZoneGroup Coordinator=\"" + lid + "\">" + l + "</ZoneGroup><ZoneGroup Coordinator=\"" + kid + "\">" + k + "</ZoneGroup>") + "</ZoneGroups>";
}
struct Fixture {
  bool grouped = true, living_leader = false, missing_living = false, all_fail = false;
  bool live[2] = {true,true}, tv[2] = {false,false}, fail[2] = {false,false};
  int volume[2] = {5,7};
  std::string title[2] = {"Living track","Kitchen track"};
};
int poll(State &s, const Fixture &f) {
  s.begin(living,kitchen); int requests = 0;
  while(s.has_request()) {
    assert(++requests < 12);
    const auto q = s.request(); int i = q.host == living ? 0 : 1;
    assert(q.action.rfind("Get",0) == 0); // Polling must never control playback.
    if (f.all_fail || f.fail[i]) { s.accept(0,""); continue; }
    std::string body;
    if(q.action == "GetZoneGroupState") body = "<ZoneGroupState>" + escape(topology(f.grouped,f.living_leader,f.missing_living)) + "</ZoneGroupState>";
    if(q.action == "GetTransportInfo") body = std::string("<CurrentTransportState>") + (f.live[i] ? "PLAYING" : "PAUSED_PLAYBACK") + "</CurrentTransportState>";
    if(q.action == "GetMediaInfo") body = std::string("<CurrentURI>") + (f.tv[i] ? "x-sonos-htastream:RINCON_foo:spdif" : "x-rincon-queue:foo#0") + "</CurrentURI>";
    if(q.action == "GetPositionInfo") body = "<TrackMetaData>" + escape("<DIDL-Lite><item><dc:title>" + escape(f.title[i]) +
      "</dc:title><dc:creator>Artist &amp; guest</dc:creator><upnp:albumArtURI>/getaa?s=1&amp;u=track</upnp:albumArtURI></item></DIDL-Lite>") + "</TrackMetaData>";
    if(q.action == "GetVolume") body = "<CurrentVolume>" + std::to_string(f.volume[i]) + "</CurrentVolume>";
    s.accept(200,response(q.action,body));
  }
  s.finish(); return requests;
}
void test_xml() {
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
  assert(poll(s,f) == 6);
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
  State s; Fixture f; f.grouped = false; f.tv[0] = true;
  poll(s,f); assert(s.selected == 1);
  s.capture(); poll(s,f); assert(s.prepare_command(0));
  assert(s.request().host == kitchen && s.request().action == "Pause");
  s.accept(200,response("Pause","")); assert(!s.has_request() && !s.command_failed);
  f.live[1] = false; poll(s,f); assert(s.command_confirmed());
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
int main(int argc, char **argv) {
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
  test_xml(); test_states(); test_controls();
  std::cout << "PASS: Sonos XML, topology/coordinator, solo/group, music/TV priority, selection, offline, artwork and scoped controls" << std::endl;
}
