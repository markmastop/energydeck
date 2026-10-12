#include "online_image.h"
#include "cover_redirect.h"
#include "station_artwork.h"
#include "radionl_logo.h"
#include "esphome/core/log.h"

namespace esphome::online_image {
OnlineImage::OnlineImage(const std::string &url, int width, int height, runtime_image::ImageFormat format,
                         image::ImageType type, image::Transparency transparency, image::Image *placeholder,
                         uint32_t, bool is_big_endian)
    : RuntimeImage(format, type, transparency, placeholder, is_big_endian, width, height) {
  set_url(url);
}
bool OnlineImage::validate_url_(const std::string &url) {
  return url == energydeck_artwork::RADIONL_COVER ||
    (!url.empty() && url.size() <= 2048 && (url.starts_with("http://") || url.starts_with("https://")));
}
void OnlineImage::update() {
  if (pending_) return;
  if (!validate_url_(url_)) { download_error_callback_.call(); return; }
  auto decoded = std::make_shared<WorkerImage>(format_, type_, transparency_, nullptr, is_big_endian_, fixed_width_, fixed_height_);
  background_http::Request request;
  request.url = url_;
  request.max_bytes = 512 * 1024;
  request.timeout_ms = 15000;
  request.headers.push_back({"Accept", "image/png,image/jpeg,*/*;q=0.8"});
  if (!etag_.empty()) request.headers.push_back({"If-None-Match", etag_});
  if (!last_modified_.empty()) request.headers.push_back({"If-Modified-Since", last_modified_});
  for (auto &header : request_headers_) request.headers.push_back({header.first, header.second.value()});
  const auto generation = ++generation_;
  pending_ = true;
  cancelled_ = std::make_shared<std::atomic<bool>>(false);
  auto work = [request = std::move(request), decoded, cancelled = cancelled_]() mutable {
    if (cancelled->load(std::memory_order_acquire)) return background_http::Reply{};
    if (request.url == energydeck_artwork::RADIONL_COVER) {
      // Keep decoding and publication on the existing UI-first worker path.
      // This baseline asset needs no TLS/download or progressive JPEG decoder.
      std::string bytes(reinterpret_cast<const char *>(RADIONL_LOGO), sizeof(RADIONL_LOGO));
      background_http::Reply reply;
      reply.status_code = decoded->decode_complete(bytes, false) ? 200 : 0;
      return reply;
    }
    auto reply = background_http::perform_http(request);
    if (reply.status_code == 301 || reply.status_code == 302 || reply.status_code == 303 || reply.status_code == 307 || reply.status_code == 308) {
      const auto target = reply.header("location");
      if (allowed_cover_redirect(request.url, target)) {
        request.url = target;
        request.headers.clear(); // One allowlisted hop; never forward Authorization or caching headers.
        const auto elapsed = reply.duration_ms;
        request.timeout_ms = elapsed < request.timeout_ms ? request.timeout_ms - elapsed : 0;
        reply = request.timeout_ms ? background_http::perform_http(request) : background_http::Reply{};
        reply.duration_ms += elapsed;
      }
    }
    if (reply.status_code == 200 && !decoded->decode_complete(reply.body, reply.header("content-type").find("image/png") == 0))
      reply.status_code = 0;
    reply.body.clear(); // Compressed bytes are never retained alongside published UI images.
    return reply;
  };
  auto done = [this, generation, decoded, local = url_ == energydeck_artwork::RADIONL_COVER](background_http::Reply reply) {
    if (generation != generation_) return;
    pending_ = false;
    if (reply.status_code == 304 && published_) { download_finished_callback_.call(true); return; }
    if (reply.status_code != 200) { download_error_callback_.call(); return; }
#ifdef USE_LVGL
    lv_image_cache_drop(get_lv_image_dsc()); // Drop references before replacing the old owned pixel buffer.
#endif
    published_ = decoded;
    data_start_ = published_->get_data_start();
    width_ = published_->get_width(); height_ = published_->get_height();
    etag_ = reply.header("etag"); last_modified_ = reply.header("last-modified");
    if (local) ESP_LOGD("online_image", "Local station artwork ready: %ux%u",
      static_cast<unsigned>(width_), static_cast<unsigned>(height_));
    download_finished_callback_.call(false);
  };
  if (!parent_->enqueue(std::move(work), done, 2, cancelled_)) done({});
}
void OnlineImage::release() {
  ++generation_; pending_ = false;
  if (cancelled_) cancelled_->store(true, std::memory_order_release);
#ifdef USE_LVGL
  lv_image_cache_drop(get_lv_image_dsc());
#endif
  data_start_ = nullptr; width_ = height_ = 0;
  published_.reset();
  etag_.clear(); last_modified_.clear();
  RuntimeImage::release();
}
}  // namespace esphome::online_image
