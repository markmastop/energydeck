// Link the simulator's actual components/LVGL and exercise only synthetic jobs
// and a loopback HTTP server. No Homey/Sonos/charging commands are used.
#include "esphome/components/background_http/background_http.h"
#include "esphome/components/online_image/online_image.h"
#include "esphome/components/ui_performance/ui_priority.h"
#include "esphome/core/hal.h"
#include "esphome/core/base_automation.h"
#include <cassert>
#include <chrono>
#include <fstream>
#include <iostream>
#include <thread>
using namespace esphome;
using namespace esphome::background_http;
namespace esphome::host {
char **get_argv() { return nullptr; }
const std::string &get_exe_path() { static const std::string path; return path; }
void arm_reexec(const std::string &) {}
const char *get_reexec_path() { return nullptr; }
}
static int frames = 0, taps = 0;
static lv_indev_state_t touch_state = LV_INDEV_STATE_RELEASED;
static lv_point_t touch_point{20,20};
static void pump(BackgroundHttp &http, int ms) {
  for (int elapsed = 0; elapsed < ms; elapsed += 5) {
    lv_tick_inc(5);
    lv_indev_read(lv_indev_get_next(nullptr));
    lv_obj_invalidate(lv_screen_active());
    lv_timer_handler();
    http.loop();
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
}
static std::string read(const std::string &path) {
  std::ifstream file(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(file), std::istreambuf_iterator<char>()};
}
int main(int argc, char **argv) {
  assert(argc == 3);
  const std::string base = argv[1], assets = argv[2];
  lv_init();
  auto *display = lv_display_create(480, 800);
  static uint16_t pixels[480 * 40];
  lv_display_set_buffers(display, pixels, nullptr, sizeof(pixels), LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(display, [](lv_display_t *d, const lv_area_t *, uint8_t *) { ++frames; lv_display_flush_ready(d); });
  auto *button = lv_button_create(lv_screen_active());
  lv_obj_set_size(button, 100, 100); lv_obj_set_pos(button, 0, 0);
  lv_obj_add_event_cb(button, [](lv_event_t *) { ++taps; }, LV_EVENT_CLICKED, nullptr);
  auto *input = lv_indev_create();
  lv_indev_set_type(input, LV_INDEV_TYPE_POINTER); lv_indev_set_mode(input, LV_INDEV_MODE_EVENT);
  lv_indev_set_read_cb(input, [](lv_indev_t *, lv_indev_data_t *data) { data->point = touch_point; data->state = touch_state; });
  BackgroundHttp http;
  http.setup();
  pump(http, 200);
  assert(ui_performance::background_allowed());
  bool delivered = false;
  const auto main_thread = std::this_thread::get_id();
  Request request; request.url = base + "/slow";
  request.headers = {{"Authorization", "Bearer synthetic-test-token"}};
  assert(http.submit(request, [&](Reply reply) {
    assert(std::this_thread::get_id() == main_thread);
    assert(reply.status_code == 200 && reply.body == "complete");
    delivered = true;
  }, 1));
  http.loop();
  const auto first_frames = frames;
  for (int i = 0; i < 3; ++i) {
    touch_state = LV_INDEV_STATE_PRESSED; pump(http, 30);
    assert(!ui_performance::background_allowed());
    touch_state = LV_INDEV_STATE_RELEASED; pump(http, 30);
  }
  assert(taps == 3 && frames > first_frames && !delivered); // Real pointer input/render continue during I/O.
  touch_state = LV_INDEV_STATE_PRESSED; pump(http, 400);
  assert(!delivered); // Worker has finished; holding touch still defers publication.
  touch_state = LV_INDEV_STATE_RELEASED; pump(http, 100);
  assert(!delivered); // Quiet window after release.
  pump(http, 120); assert(delivered);

  // Repeated cancelled polls cannot crowd controls out of the bounded queue.
  for (int i = 0; i < 40; ++i) {
    auto cancelled = std::make_shared<std::atomic<bool>>(false);
    assert(http.enqueue([]() { assert(false); return Reply{}; }, [](Reply) { assert(false); }, 1, cancelled));
    cancelled->store(true, std::memory_order_release);
  }
  std::vector<int> order;
  for (auto [value, priority] : {std::pair{2,2}, std::pair{1,1}, std::pair{0,0}, std::pair{3,1}})
    assert(http.enqueue([value, main_thread]() {
      assert(std::this_thread::get_id() != main_thread);
      Reply reply; reply.status_code = 200; reply.body = std::to_string(value); return reply;
    }, [&](Reply reply) { order.push_back(std::stoi(reply.body)); }, priority));
  pump(http, 200);
  assert((order == std::vector<int>{0,1,3,2}));

  // Actual asynchronous action: script continuations cannot run at enqueue time.
  SendAction<> send(&http);
  send.set_url(base + "/chunked"); send.set_method("GET");
  bool continued = false, success = false;
  LambdaAction<> next([&]() { assert(success); continued = true; });
  ActionList<> chain; chain.add_actions({&send, &next});
  Automation<std::shared_ptr<Reply>, std::string &> response(send.get_success_trigger());
  LambdaAction<std::shared_ptr<Reply>, std::string &> on_reply([&](std::shared_ptr<Reply> reply, std::string &body) {
    assert(reply->status_code == 200 && body == "firstsecond" && reply->header("etag") == "test"); success = true;
  });
  response.add_action(&on_reply);
  chain.play();
  assert(chain.is_running() && !continued);
  pump(http, 300);
  assert(continued && !chain.is_running());
  continued = success = false;
  chain.play(); chain.stop(); pump(http, 150);
  assert(!chain.is_running() && !continued && !success);
  send.set_url(base + "/post"); send.set_method("POST"); send.set_body("{}");
  chain.play(); chain.stop(); pump(http, 80); // Cancelled queued writes must not reach the server. // A stopped action never resumes via a late response.

  for (const auto *path : {"/oversized", "/truncated", "/stall"}) {
    Request bad; bad.url = base + path; bad.max_bytes = 16; bad.timeout_ms = 120;
    const auto reply = perform_http(bad);
    assert(reply.status_code == 0 && reply.body.empty());
  }
  // A response automation can restart its parent. The old reply must not
  // advance the new invocation before its own response arrives.
  SendAction<> restart_send(&http);
  restart_send.set_url(base + "/chunked"); restart_send.set_method("GET");
  int replies = 0, continuations = 0;
  LambdaAction<> restart_next([&]() { assert(replies == 2); ++continuations; });
  ActionList<> restart_chain; restart_chain.add_actions({&restart_send, &restart_next});
  Automation<std::shared_ptr<Reply>, std::string &> restart_response(restart_send.get_success_trigger());
  LambdaAction<std::shared_ptr<Reply>, std::string &> restart_reply([&](std::shared_ptr<Reply>, std::string &) {
    if (++replies == 1) { restart_chain.stop(); restart_chain.play(); }
  });
  restart_response.add_action(&restart_reply);
  restart_chain.play(); pump(http, 400);
  assert(replies == 2 && continuations == 1 && !restart_chain.is_running());

  Request redirect; redirect.url = base + "/redirect";
  const auto redirect_reply = perform_http(redirect);
  assert(redirect_reply.status_code == 302 && redirect_reply.header("location") == "/must-not-follow");
  Request post; post.url = base + "/post"; post.method = "POST"; post.body = "{}";
  assert(perform_http(post).status_code == 200);
  Request count; count.url = base + "/count";
  assert(perform_http(count).body == "1"); // No implicit retries, even for writes.

  for (const auto *name : {"image.png", "image.jpg"}) {
    auto bytes = read(assets + "/" + name);
    online_image::WorkerImage image(runtime_image::JPEG, image::IMAGE_TYPE_RGB565, image::TRANSPARENCY_OPAQUE, nullptr, false, 32, 32);
    assert(image.decode_complete(bytes, std::string(name).ends_with("png")));
    assert(image.get_width() == 32 && image.get_height() == 16);
    const auto color = image.get_pixel(8, 8);
    assert(color.r >= 240 && color.g < 15 && color.b < 15); // Preserve colors and aspect ratio.
    const auto *stable = image.get_data_start();
    auto png = read(assets + "/image.png");
    online_image::WorkerImage another(runtime_image::JPEG, image::IMAGE_TYPE_RGB565, image::TRANSPARENCY_OPAQUE, nullptr, false, 32, 32);
    assert(another.decode_complete(png, true) && image.get_data_start() == stable);
  }
  for (const auto *name : {"truncated.png", "truncated.jpg", "progressive.jpg", "invalid.png"}) {
    auto bytes = read(assets + "/" + name);
    online_image::WorkerImage bad(runtime_image::JPEG, image::IMAGE_TYPE_RGB565, image::TRANSPARENCY_OPAQUE, nullptr, false, 32, 32);
    assert(!bad.decode_complete(bytes, std::string(name).ends_with("png")) && !bad.is_loaded());
  }
  // Full component: an old in-flight image cannot overwrite a newer URL;
  // conditional caching and publication preserve UI-owned pixels until complete.
  online_image::OnlineImage cover(base + "/image-slow", 32, 32, runtime_image::JPEG,
      image::IMAGE_TYPE_RGB565, image::TRANSPARENCY_OPAQUE, nullptr, 2048, true);
  cover.set_parent(&http);
  int covers = 0, errors = 0; bool cached = false;
  cover.add_on_finished_callback([&](bool hit) { ++covers; cached = hit; });
  cover.add_on_error_callback([&]() { ++errors; });
  cover.update(); http.loop(); pump(http, 40);
  cover.set_url(base + "/image"); cover.update();
  pump(http, 500);
  assert(cover.is_loaded());
  assert(covers == 1 && !cached && errors == 0 && !cover.is_pending());
  assert(cover.get_width() == 32 && cover.get_height() == 16);
  const auto *published = cover.get_data_start();
  cover.update(); pump(http, 150);
  assert(covers == 2 && cached && cover.get_data_start() == published);
  cover.set_url(base + "/image-slow"); cover.update(); http.loop(); pump(http, 40);
  cover.release(); pump(http, 400);
  assert(covers == 2 && errors == 0 && !cover.get_data_start() && !cover.is_loaded() && !cover.is_pending());

  std::cout << "PASS: live LVGL input/render during slow HTTP, UI-first publication, FIFO priorities, asynchronous action completion/cancellation, chunked/bounded/deadline reads, redirects/write-once and isolated PNG/JPEG decoding\n";
}
