#include "../esphome/components/sonos_local/sonos_local.h"
#include <cassert>
#include <iostream>
using namespace energydeck_sonos;
static const std::string host = "http://192.168.1.50:1400", uri = "x-rincon-queue:ROOM#0";
static std::string reply(const std::string &action, const std::string &body) {
  return "<Envelope><Body><" + action + "Response>" + body + "</" + action + "Response></Body></Envelope>";
}
static int run(Queue &q, int total, const std::string &mode, bool mutate = false) {
  int pages = 0;
  while (q.has_request()) {
    const auto r = q.request();
    assert(r.host == host && (r.action == "Browse" || r.action == "GetTransportSettings"));
    if (r.action == "GetTransportSettings") { q.accept(200, reply(r.action, "<PlayMode>" + mode + "</PlayMode>")); continue; }
    assert(++pages <= 6);
    Xml args("<args>" + r.arguments + "</args>");
    assert(args.text("ObjectID") == "Q:0");
    const int start = number(args.text("StartingIndex")), count = number(args.text("RequestedCount"));
    const int returned = std::max(0, std::min(count, total - start));
    std::string didl = "<DIDL-Lite>";
    for (int i = 0; i < returned; ++i) didl += "<item><title>Track " + std::to_string(start+i+1) + " &amp; title</title><creator>Artist</creator><res>secret-resource</res></item>";
    didl += "</DIDL-Lite>";
    q.accept(200, reply(r.action, "<NumberReturned>" + std::to_string(returned) + "</NumberReturned><TotalMatches>" + std::to_string(total) + "</TotalMatches><UpdateID>" + (mutate && pages > 1 ? "2" : "1") + "</UpdateID><Result>" + xml_escape(didl) + "</Result>"));
  }
  return pages;
}
int main() {
  Queue q;
  q.begin(host, uri, 4, true); assert(run(q, 5, "NORMAL") == 1);
  assert(q.known && q.total == 5 && q.items.size() == 5 && q.next()->number == 5);
  assert(q.next()->title == "Track 5 & title" && q.matches(host, uri, 4) && !q.matches(host, uri, 5));
  q.begin(host, uri, 5); run(q, 5, "NORMAL"); assert(q.known && !q.next());
  q.begin(host, uri, 5); run(q, 5, "REPEAT_ALL"); assert(q.next() && q.next()->number == 1);
  q.begin(host, uri, 4); run(q, 5, "REPEAT_ONE"); assert(q.next()->number == 4);
  for (const auto &mode : {"SHUFFLE", "SHUFFLE_NOREPEAT", "SHUFFLE_REPEAT_ONE", "UNKNOWN"}) {
    q.begin(host, uri, 4); run(q, 5, mode); assert(q.known && !q.next());
  }
  q.begin(host, uri, 80, true); assert(run(q, 100, "NORMAL") == 5);
  assert(q.known && q.total == 100 && q.items.front().number == 61 && q.items.size() == 40 && q.next()->number == 81);
  q.begin(host, uri, 1, true); assert(run(q, 1000, "NORMAL") == 5);
  assert(q.known && q.items.size() == 40 && q.total == 1000);
  q.begin(host, uri, 1, true); run(q, 20, "NORMAL", true); assert(q.failed && !q.known && q.items.empty());
  q.begin(host, uri, 0, true); run(q, 0, "NORMAL"); assert(q.known && q.total == 0 && !q.next());
  for (const auto &source : {"x-sonosapi-stream:radio", "x-sonos-htastream:tv", ""}) {
    q.begin(host, source, 0, true); assert(!q.has_request() && q.known && !q.applicable && q.items.empty());
  }
  q.begin(host, uri, 1, true); q.accept(0, ""); assert(q.failed && !q.known);
  q.begin(host, uri, 1, true); q.accept(200, reply("GetTransportSettings", "<PlayMode>NORMAL</PlayMode>"));
  q.accept(200, reply("Browse", "<NumberReturned>1</NumberReturned><TotalMatches>1</TotalMatches><UpdateID>1</UpdateID><Result>&lt;DIDL-Lite/&gt;</Result>"));
  assert(q.failed && !q.known && q.items.empty());
  std::cout << "PASS: read-only queue pagination, exact total, current/next, repeat, shuffle, bounds, version changes, malformed/failed reads and radio/TV without a queue" << std::endl;
}
