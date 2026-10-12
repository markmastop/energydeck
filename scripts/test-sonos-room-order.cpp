#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <iostream>

using namespace energydeck_sonos;
static std::string transport(const std::string &value) {
  return "<GetTransportInfoResponse><CurrentTransportState>" + value + "</CurrentTransportState></GetTransportInfoResponse>";
}
static std::vector<std::string> names(const State &state, const RoomActivity &activity) {
  std::vector<std::string> result;
  for (const auto index : activity.order(state)) result.push_back(state.systems[index].name);
  return result;
}
int main() {
  State state;
  state.systems = {
    {"living", "Woonkamer", "living", "", "http://192.168.0.190:1400", ""},
    {"addition", "aanbouw", "addition", "", "http://192.168.0.192:1400", ""},
    {"kitchen", "Keuken", "kitchen", "", "http://192.168.0.191:1400", ""},
    {"office", "Bureau", "addition", "", "http://192.168.0.192:1400", ""},
    {"bedroom", "Slaapkamer", "bedroom", "", "http://192.168.0.193:1400", ""},
  };
  state.rooms[0].coordinator = "living";
  state.rooms[0].topology = state.rooms[0].transport = true;
  state.rooms[0].playing = true;
  state.rooms[1].coordinator = "kitchen";
  state.rooms[1].topology = state.rooms[1].transport = true;
  RoomActivity activity;
  activity.begin(state);
  assert(activity.has_request() && activity.request().host == "http://192.168.0.192:1400");
  assert(activity.request().action == "GetTransportInfo");
  activity.accept(200, transport("PLAYING"));
  assert(activity.has_request() && activity.request().host == "http://192.168.0.193:1400");
  activity.accept(200, transport("PAUSED_PLAYBACK"));
  assert(!activity.has_request()); // One request per unpolled group, including its followers.
  activity.finish();
  assert((names(state, activity) == std::vector<std::string>{"aanbouw", "Bureau", "Woonkamer", "Keuken", "Slaapkamer"}));
  assert(state.systems[0].uuid == "living"); // Presentation order never mutates command/model identities.

  state.rooms[0].playing = false;
  activity.begin(state);
  assert(activity.request().host == "http://192.168.0.193:1400"); // Scan starts rotate after a partial/slow cycle.
  activity.accept(0, ""); // Failed activity becomes unknown, never a stale playing room.
  activity.accept(200, transport("TRANSITIONING"));
  activity.finish();
  assert((names(state, activity) == std::vector<std::string>{"aanbouw", "Bureau", "Keuken", "Slaapkamer", "Woonkamer"}));
  state.systems[1].coordinator_host = "http://example.com:1400";
  state.systems[3].coordinator_host = "http://example.com:1400";
  activity.begin(state);
  assert(activity.request().host == "http://192.168.0.193:1400");
  activity.accept(200, "<Fault/>");
  activity.finish();
  assert(activity.transport(state.systems[4]) == RoomActivity::UNKNOWN);

  state.systems.clear();
  activity.begin(state); activity.finish();
  assert(!activity.has_request() && activity.order(state).empty());
  std::cout << "PASS: playing first, case-insensitive alphabetical order, grouped activity, failures, unsafe endpoints and stable identities\n";
}
