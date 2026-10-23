// Synthetic protocol/transport coverage. Optional --live mode only subscribes
// to configured Homey sources; it cannot write capabilities or start Flows.
#include "esphome/components/homey_realtime/protocol.h"
#include "esphome/components/homey_realtime/websocket.h"
#include <cassert>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <random>
using esphome::homey_realtime::Protocol;
using esphome::homey_realtime::WebSocket;
namespace esphome {
uint32_t millis() {
  static const auto start = std::chrono::steady_clock::now();
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - start).count();
}
bool random_bytes(uint8_t *data, size_t size) { std::random_device random; while (size--) *data++ = random(); return true; }
}
static void establish(Protocol &protocol) {
  assert(protocol.receive("0{\"pingInterval\":25000,\"pingTimeout\":20000}", 0));
  assert(protocol.receive("40", 0));
  assert(protocol.receive("430[null,{\"namespace\":\"/api\"}]", 0));
  assert(protocol.receive("40/api,", 0));
  assert(protocol.receive("43/api,1[null]", 0));
  assert(protocol.receive("43/api,2[]", 0)); // Homey also acknowledges with no arguments.
  assert(protocol.ready());
}
static void unit() {
  std::vector<std::string> sent;
  int device = 0, prices = 0;
  Protocol protocol("tok\"en", "homey", {"homey:device:meter", "homey:manager:logic"},
    [&](const std::string &packet) { sent.push_back(packet); return true; }, [&](size_t i) { i ? prices++ : device++; }, 0);
  protocol.set_price_id("prices");
  establish(protocol);
  assert(sent.size() == 4);
  assert(sent[0] == "420[\"handshakeClient\",{\"token\":\"tok\\\"en\",\"homeyId\":\"homey\"}]");
  assert(sent[1] == "40/api,");
  assert(sent[2] == "42/api,1[\"subscribe\",\"homey:device:meter\"]");
  assert(sent[3] == "42/api,2[\"subscribe\",\"homey:manager:logic\"]");
  assert(device == 1 && prices == 1); // Reconcile each source on first connection.
  assert(protocol.receive("42/api,[\"homey:device:unconfigured\",\"capability\",{}]", 0));
  assert(protocol.receive("42/api,[\"homey:device:meter\",\"capability\",{\"value\":0}]", 0));
  assert(protocol.receive("42/api,[\"homey:manager:logic\",\"variable.update\",{\"id\":\"other\"}]", 0));
  assert(device == 2 && prices == 1);
  assert(protocol.receive("42/api,[\"homey:manager:logic\",\"variable.update\",{\"id\":\"prices\"}]", 0));
  assert(prices == 2);
  assert(protocol.tick(25000) && sent.back() == "2");
  assert(protocol.receive("3", 25001));
  assert(protocol.tick(50001) && sent.back() == "2");
  assert(!protocol.tick(70002)); // Missing heartbeat cannot remain healthy.
  assert(!protocol.receive(std::string(Protocol::MAX_PACKET + 1, 'x'), 0));
  for (const std::string bad : {"430[{\"message\":\"denied\"}]", "430[null,{\"namespace\":\"/api,evil\"}]"}) {
    Protocol rejected("token", "homey", {}, [](const auto &) { return true; }, [](size_t) {}, 0);
    assert(rejected.receive("0{\"pingInterval\":25000,\"pingTimeout\":20000}", 0));
    assert(rejected.receive("40", 0)); assert(!rejected.receive(bad, 0)); assert(!rejected.ready());
  }
  Protocol denied("token", "homey", {"homey:device:meter"}, [](const auto &) { return true; }, [](size_t) {}, 0);
  assert(denied.receive("0{\"pingInterval\":25000,\"pingTimeout\":20000}", 0));
  assert(denied.receive("40", 0)); assert(denied.receive("430[null,{\"namespace\":\"/api\"}]", 0));
  assert(denied.receive("40/api,", 0)); assert(!denied.receive("43/api,1[{\"message\":\"denied\"}]", 0));
  Protocol timeout("token", "homey", {}, [](const auto &) { return true; }, [](size_t) {}, 0);
  assert(!timeout.tick(10001));
  Protocol malformed("token", "homey", {}, [](const auto &) { return true; }, [](size_t) {}, 0);
  assert(!malformed.receive("0{\"pingInterval\":0,\"pingTimeout\":20000}", 0));
  std::cout << "Homey protocol: authentication, subscriptions, filtering, bounds and heartbeat passed\n";
}
int main(int argc, char **argv) {
  unit();
  if (argc < 2) return 0;
  const bool live = std::string(argv[1]) == "--live";
  const auto env = [](const char *key) -> std::string { const auto *value = std::getenv(key); return value ? value : ""; };
  const std::string address = live ? env("HOMEY_ADDRESS") : argv[2];
  const std::string token = live ? env("HOMEY_TOKEN") : "synthetic-test-token";
  const std::string homey = live ? env("ENERGYDECK_TEST_HOMEY_ID") : "test-homey-id";
  const std::string meter = live ? env("HOMEY_HOMEWIZARD_DEVICE_ID") : "meter";
  const std::string price = live ? env("HOMEY_PRICES_VARIABLE_ID") : "prices";
  WebSocket socket;
  if (!socket.connect(address)) { std::cerr << "WebSocket connection failed\n"; return 1; }
  std::vector<std::string> uris{"homey:device:" + meter, "homey:manager:logic"};
  int device_changes = 0, price_changes = 0;
  Protocol protocol(token, homey, uris, [&](const std::string &packet) { return socket.send(packet); },
    [&](size_t i) { i ? price_changes++ : device_changes++; }, esphome::millis());
  protocol.set_price_id(price);
  const auto start = esphome::millis();
  while (uint32_t(esphome::millis() - start) < (live ? 8000 : 5000) && protocol.tick(esphome::millis())) {
    std::string packet; const int result = socket.receive(packet);
    if (result < 0) break;
    if (result > 0 && !protocol.receive(packet, esphome::millis())) {
      std::cerr << "Rejected socket packet: type=" << packet.substr(0, 2) << ", bytes=" << packet.size() << '\n'; break;
    }
  }
  if (!protocol.ready()) { std::cerr << "Homey authentication/subscriptions did not complete\n"; return 1; }
  if (!live) assert(device_changes == 2 && price_changes == 2);
  std::cout << "Direct Homey socket: " << uris.size() << " subscriptions; " << device_changes + price_changes << " notifications\n";
}
