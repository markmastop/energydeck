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
  bool radio = false;
  bool grouped = true, living_leader = false, missing_living = false, all_fail = false;
  bool live[2] = {true,true}, tv[2] = {false,false}, fail[2] = {false,false};
  int volume[2] = {5,7};
  std::string title[2] = {"Living track","Kitchen track"};
};
int poll(State &s, const Fixture &f) {
  s.begin(living,kitchen); int requests = 0;
  while(s.has_request()) {
    assert(++requests < 20);
    const auto q = s.request(); int i = q.host == living ? 0 : 1;
    assert(q.action.rfind("Get",0) == 0); // Polling must never control playback.
    if (f.all_fail || f.fail[i]) { s.accept(0,""); continue; }
    std::string body;
    if(q.action == "GetZoneGroupState") body = "<ZoneGroupState>" + escape(topology(f.grouped,f.living_leader,f.missing_living)) + "</ZoneGroupState>";
    if(q.action == "GetTransportInfo") body = std::string("<CurrentTransportState>") + (f.live[i] ? "PLAYING" : "PAUSED_PLAYBACK") + "</CurrentTransportState>";
    if(q.action == "GetMediaInfo") body = std::string("<CurrentURI>") + (f.tv[i] ? "x-sonos-htastream:RINCON_foo:spdif" : "x-rincon-queue:foo#0") + "</CurrentURI>";
    if(q.action == "GetPositionInfo") body = "<TrackMetaData>" + escape("<DIDL-Lite><item><dc:title>" + escape(f.title[i]) +
      "</dc:title><dc:creator>Artist &amp; guest</dc:creator><upnp:albumArtURI>/getaa?s=1&amp;u=track</upnp:albumArtURI></item></DIDL-Lite>") + "</TrackMetaData>";
    if (f.radio && q.action == "GetMediaInfo") body += "<CurrentURIMetaData>" + escape("<item><title>Qmusic</title><albumArtURI>https://sali.sonos.superhi.fi/image?w=60&amp;image=logo.png</albumArtURI></item>") + "</CurrentURIMetaData>";
    if (f.radio && q.action == "GetPositionInfo") body = "<TrackMetaData>" + escape("<item><title>stream.mp3?secret=hidden</title><streamContent>Song - Artist</streamContent></item>") + "</TrackMetaData>";
    if(q.action == "GetVolume") body = "<CurrentVolume>" + std::to_string(f.volume[i]) + "</CurrentVolume>";
    if(q.action == "GetMute") body = "<CurrentMute>0</CurrentMute>";
    if(q.action == "GetCurrentTransportActions") body = "<Actions>Play,Pause,Next,Previous</Actions>";
    s.accept(200,response(q.action,body));
  }
  s.finish(); return requests;
}
void test_xml() {
  assert(artwork_url("https://sali.sonos.superhi.fi/image?x=1", living) == "https://sali.sonos.superhi.fi/image?x=1");
  for (auto url : {"https://sali.sonos.superhi.fi.evil/image", "https://sali.sonos.radio@evil/image", "http://sali.sonos.radio/image", "//evil/image"}) assert(artwork_url(url, living).empty());
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

Favorite favorite(bool radio = false, std::string id = "FV:2/1") {
  const std::string cls = radio ? "object.item.audioItem.audioBroadcast" : "object.container.playlistContainer";
  return {id, "Rock & Soul", radio ? "x-sonosapi-stream:radio?sid=1&flags=2" : "x-rincon-cpcontainer:playlist?sid=9&flags=2",
    "<DIDL-Lite><item><upnp:class>" + cls + "</upnp:class><dc:title>Rock &amp; Soul</dc:title></item></DIDL-Lite>", radio};
}
std::string favorite_page(const std::vector<Favorite> &items, int total, std::string version = "1") {
  std::string didl = "<DIDL-Lite>";
  for (const auto &f : items) didl += "<item id=\"" + f.id + "\"><dc:title>" + escape(f.title) + "</dc:title><res>" + escape(f.uri) +
    "</res><r:resMD>" + escape(f.metadata) + "</r:resMD></item>";
  didl += "</DIDL-Lite>";
  return response("Browse", "<Result>" + escape(didl) + "</Result><NumberReturned>" + std::to_string(items.size()) +
    "</NumberReturned><TotalMatches>" + std::to_string(total) + "</TotalMatches><UpdateID>" + version + "</UpdateID>");
}
void test_favorites() {
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
  assert(s.request().arguments.find("sid=1&amp;flags=2") != std::string::npos);
  s.accept(200,response("SetAVTransportURI","")); assert(s.request().action == "Play");
  s.accept(200,response("Play","")); assert(!s.has_request() && !s.command_failed);
  assert(!s.command_confirmed()); // Old playing track is not confirmation.
  s.rooms[1].uri = radio.uri; assert(s.command_confirmed());
  s.capture(); poll(s,fixture); assert(s.prepare_favorite(music));
  assert(s.request().action == "AddURIToQueue" && s.request().arguments.find("<EnqueueAsNext>0</EnqueueAsNext>") != std::string::npos);
  s.accept(200,response("AddURIToQueue","<FirstTrackNumberEnqueued>17</FirstTrackNumberEnqueued><NumTracksAdded>20</NumTracksAdded>"));
  assert(s.request().action == "SetAVTransportURI"); s.accept(200,response("SetAVTransportURI",""));
  assert(s.request().action == "Seek" && s.request().arguments.find("<Target>17</Target>") != std::string::npos);
  s.accept(200,response("Seek","")); assert(s.request().action == "Play"); s.accept(200,response("Play",""));
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
}
int main(int argc, char **argv) {
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
  test_xml(); test_states(); test_controls(); test_favorites();
  std::cout << "PASS: paged favorites, filtering, XML escaping, direct radio, queue append/seek, failed-command abort, mute and skip" << std::endl;
  std::cout << "PASS: Sonos XML, topology/coordinator, solo/group, music/TV priority, selection, offline, artwork and scoped controls" << std::endl;
}
