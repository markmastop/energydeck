#pragma once

#include "worker_image.h"
#include "esphome/components/background_http/background_http.h"
#include "esphome/components/runtime_image/runtime_image.h"
#include "esphome/core/automation.h"
#include "esphome/core/component.h"
#include "esphome/core/defines.h"
#include "esphome/core/helpers.h"
#include "favorite_artwork.h"
#ifdef USE_LVGL
#include "src/misc/cache/instance/lv_image_cache.h"
#endif

namespace esphome::online_image {

/**
 * @brief Download an image from a given URL, and decode it using the specified decoder.
 * The image will then be stored in a buffer, so that it can be re-displayed without the
 * need to re-download or re-decode.
 */
class OnlineImage final : public PollingComponent,
                          public runtime_image::RuntimeImage,
                          public Parented<esphome::background_http::BackgroundHttp> {
 public:
  /**
   * @brief Construct a new OnlineImage object.
   *
   * @param url URL to download the image from.
   * @param width Desired width of the target image area.
   * @param height Desired height of the target image area.
   * @param format Format that the image is encoded in (@see runtime_image::ImageFormat).
   * @param type The pixel format for the image.
   * @param transparency The transparency type for the image.
   * @param placeholder Optional placeholder image to show while loading.
   * @param buffer_size Retained schema compatibility; complete responses are bounded to 512 KiB.
   * @param is_big_endian Whether the image is stored in big-endian format.
   */
  OnlineImage(const std::string &url, int width, int height, runtime_image::ImageFormat format, image::ImageType type,
              image::Transparency transparency, image::Image *placeholder, uint32_t buffer_size,
              bool is_big_endian = false);

  void update() override;
  bool is_pending() const { return pending_; }
  bool is_loaded() const { return data_start_ != nullptr; }

  /** Set the URL to download the image from. */
  void set_url(const std::string &url) {
    if (this->validate_url_(url)) {
      if (url != this->url_) {
        ++generation_;
        pending_ = false;
        if (cancelled_) cancelled_->store(true, std::memory_order_release);
      }
      this->url_ = url;
    }
    this->etag_ = "";
    this->last_modified_ = "";
  }

  /** Add the request header */
  template<typename V> void add_request_header(const std::string &header, V value) {
    this->request_headers_.push_back(std::pair<std::string, TemplatableValue<std::string>>(header, value));
  }

  /**
   * Release the buffer storing the image. The image will need to be downloaded again
   * to be able to be displayed.
   */
  void release();

  template<typename F> void add_on_finished_callback(F &&callback) {
    this->download_finished_callback_.add(std::forward<F>(callback));
  }
  template<typename F> void add_on_error_callback(F &&callback) {
    this->download_error_callback_.add(std::forward<F>(callback));
  }

 protected:
  bool validate_url_(const std::string &url);
  bool pending_{false};
  uint32_t generation_{0};
  std::shared_ptr<WorkerImage> published_;
  std::shared_ptr<std::atomic<bool>> cancelled_;
  CallbackManager<void(bool)> download_finished_callback_{};
  CallbackManager<void()> download_error_callback_{};

  std::string url_;

  std::vector<std::pair<std::string, TemplatableValue<std::string>>> request_headers_;

  /**
   * The value of the ETag HTTP header provided in the last response.
   */
  std::string etag_;
  /**
   * The value of the Last-Modified HTTP header provided in the last response.
   */
  std::string last_modified_;

};

template<typename... Ts> class OnlineImageSetUrlAction final : public Action<Ts...> {
 public:
  OnlineImageSetUrlAction(OnlineImage *parent) : parent_(parent) {}
  TEMPLATABLE_VALUE(std::string, url)
  TEMPLATABLE_VALUE(bool, update)
  void play(const Ts &...x) override {
    this->parent_->set_url(this->url_.value(x...));
    if (this->update_.value(x...)) {
      this->parent_->update();
    }
  }

 protected:
  OnlineImage *parent_;
};

template<typename... Ts> class OnlineImageReleaseAction final : public Action<Ts...> {
 public:
  OnlineImageReleaseAction(OnlineImage *parent) : parent_(parent) {}
  void play(const Ts &...x) override { this->parent_->release(); }

 protected:
  OnlineImage *parent_;
};

}  // namespace esphome::online_image
