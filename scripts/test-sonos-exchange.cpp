#include "../esphome/components/sonos_http/exchange.h"
#include <cassert>
#include <chrono>
#include <iostream>
#include <thread>

using esphome::sonos_http::Exchange;
using esphome::sonos_http::Reply;
using namespace std::chrono_literals;

int main() {
  Exchange exchange;
  energydeck_sonos::Request request{"http://192.168.0.190:1400", "AVTransport", "GetTransportInfo", "original"};
  assert(!exchange.busy() && !exchange.ready());
  assert(exchange.submit(request, 1500));
  request.arguments = "changed after submit";
  std::atomic<bool> started{false}, release{false};
  std::thread worker([&]() {
    const auto *copy = exchange.start();
    assert(copy != nullptr && copy->arguments == "original" && exchange.timeout_ms() == 1500);
    started.store(true);
    while (!release.load()) std::this_thread::sleep_for(1ms);
    exchange.complete({200, 3000, "status response"});
  });
  while (!started.load()) std::this_thread::sleep_for(1ms);
  // A delayed network operation leaves the main/UI thread free. The mailbox
  // cannot overwrite an in-flight request or hand its result to a second owner.
  for (int tick = 0; tick < 50; ++tick) {
    assert(exchange.busy() && !exchange.ready());
    assert(!exchange.submit(request));
    assert(exchange.take().status == 0 && exchange.busy());
    std::this_thread::sleep_for(1ms);
  }
  release.store(true);
  worker.join();
  assert(exchange.ready() && exchange.busy());
  assert(!exchange.submit(request));
  auto reply = exchange.take();
  assert(reply.status == 200 && reply.duration_ms == 3000 && reply.body == "status response");
  assert(!exchange.busy());

  // Exercise ownership/memory ordering repeatedly with alternating consumers,
  // empty/error replies and unique bodies. No response may leak into the next.
  std::thread repeated([&]() {
    for (int i = 0; i < 1000; ++i) {
      const energydeck_sonos::Request *copy;
      while ((copy = exchange.start()) == nullptr) std::this_thread::yield();
      assert(copy->arguments == std::to_string(i));
      assert(exchange.timeout_ms() == 8000);
      exchange.complete({i % 2 ? 0 : 200, static_cast<uint32_t>(i), i % 2 ? "" : copy->arguments});
    }
  });
  for (int i = 0; i < 1000; ++i) {
    request.arguments = std::to_string(i);
    assert(exchange.submit(request));
    while (!exchange.ready()) std::this_thread::yield();
    reply = exchange.take();
    assert(reply.status == (i % 2 ? 0 : 200) && reply.duration_ms == static_cast<uint32_t>(i));
    assert(reply.body == (i % 2 ? "" : std::to_string(i)));
  }
  repeated.join();
  Reply bounded;
  const std::string data(Reply::MAX_BODY, 'x');
  assert(bounded.append(data.data(), data.size()));
  assert(!bounded.append("x", 1) && bounded.body.size() == Reply::MAX_BODY);
  std::cout << "PASS: delayed worker, immutable request, exclusive reply ownership, 1000 exchanges and body limit\n";
}
