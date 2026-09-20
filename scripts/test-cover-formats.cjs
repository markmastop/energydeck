// Exercise the actual format-selection block without a live speaker or UI.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'esphome/components/online_image/online_image.cpp'), 'utf8');
const start = cpp.indexOf('  bool decoder_ready;');
const end = cpp.indexOf('  if (!decoder_ready)', start);
const decoderStart = cpp.indexOf('class CompletedPngDecoder');
const decoderEnd = cpp.indexOf('\nOnlineImage::OnlineImage', decoderStart);
const musicYaml = fs.readFileSync(path.join(root, 'esphome/packages/music.yaml'), 'utf8');
const cacheHeader = fs.readFileSync(path.join(root, 'esphome/components/online_image/favorite_artwork.h'), 'utf8');
const cacheCode = cacheHeader.slice(cacheHeader.indexOf('namespace esphome::online_image'), cacheHeader.lastIndexOf('#endif'));
const thumbnailStart = musicYaml.indexOf('              const int side =');
const thumbnailEnd = musicYaml.indexOf('              mini = *source;', thumbnailStart);
if (thumbnailStart < 0 || thumbnailEnd < 0) throw new Error('Native thumbnail copy missing');
if (start < 0 || end < 0) throw new Error('Decoder selection block missing');
const source = `
#include <cassert>
#include <memory>
#include <cstddef>
#include <cstdint>
#include <vector>
#include <algorithm>
#include <array>
#include <map>
#include <set>
#include "${path.join(root, 'esphome/components/online_image/cover_redirect.h')}"
using std::make_unique;
struct lv_image_dsc_t { struct { int w = 0, h = 0, stride = 0; } header; size_t data_size = 0; const uint8_t *data = nullptr; };
void lv_image_cache_drop(const void *) {}
${cacheCode}
void test_favorite_cache() {
  esphome::online_image::FavoriteArtwork cache;
  std::array<uint8_t, 64 * 32 * 2> pixels{}; pixels.fill(17);
  lv_image_dsc_t source; source.header = {64,32,128}; source.data = pixels.data();
  cache.begin("one"); assert(cache.busy && cache.attempted("one"));
  cache.store(&source); auto *first = cache.get("one");
  assert(first && first->header.w == 32 && first->header.stride == 64 && first->data_size == 2048);
  pixels.fill(99); assert(first->data[0] == 17);
  cache.busy = false;
  cache.retain({"one"}); assert(cache.get("one") == first);
  cache.begin("failed"); cache.busy = false;
  cache.retry_failed(); assert(!cache.attempted("failed") && cache.attempted("one"));
  for (int i = 2; i <= 100; ++i) { cache.begin(std::to_string(i)); cache.store(&source); }
  assert(cache.get("one") == first && first->data[0] == 17);
  cache.begin("over-limit"); cache.store(&source); assert(!cache.get("over-limit"));
  cache.clear(); assert(!cache.get("one") && cache.attempted("over-limit"));
  cache.busy = false; cache.clear(); assert(!cache.attempted("over-limit"));
}
void test_thumbnail(int w, int h) {
  struct Image { struct { int stride; } header; const uint8_t *data; } image;
  const int stride = w * 2 + 8; // Exercise padded source rows too.
  std::vector<uint8_t> pixels(stride * h, 0);
  for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
    pixels[y * stride + x * 2] = x % 251;
    pixels[y * stride + x * 2 + 1] = y % 251;
  }
  image.header.stride = stride; image.data = pixels.data();
  const auto *source = &image;
  uint8_t guarded[62 * 62 * 2 + 2] = {};
  guarded[0] = guarded[sizeof(guarded)-1] = 123;
  auto *thumbnail = guarded + 1;
${musicYaml.slice(thumbnailStart, thumbnailEnd)}
  assert(guarded[0] == 123 && guarded[sizeof(guarded)-1] == 123);
  for (int y = 0; y < 62; ++y) for (int x = 0; x < 62; ++x) {
    assert(thumbnail[(y * 62 + x) * 2] == ((w - side) / 2 + x * side / 62) % 251);
    assert(thumbnail[(y * 62 + x) * 2 + 1] == ((h - side) / 2 + y * side / 62) % 251);
  }
  auto saved = thumbnail[0]; pixels.assign(pixels.size(), 255);
  assert(thumbnail[0] == saved); // Independent of the next full-cover decode.
}
struct pngle_t { void *user; void (*done)(pngle_t*) = nullptr; };
void pngle_set_done_callback(pngle_t *p, void (*cb)(pngle_t*)) { p->done = cb; }
void *pngle_get_user_data(pngle_t *p) { return p->user; }
namespace runtime_image {
constexpr int JPEG = 1;
struct PngDecoder {
  static bool fail;
  pngle_t png{this}, *pngle_ = &png;
  explicit PngDecoder(void*) {}
  virtual ~PngDecoder() = default;
  virtual int prepare(size_t) { return fail ? -1 : 0; }
  virtual bool is_finished() const { return false; }
};
bool PngDecoder::fail = false;
}
${cpp.slice(decoderStart, decoderEnd)}
using FallbackJpegDecoder = runtime_image::PngDecoder;
struct Image {
  int get_format() const { return runtime_image::JPEG; }
  bool png_response_ = false;
  size_t total_size_ = 0, decoded_bytes_ = 42;
  int jpeg_calls = 0;
  std::unique_ptr<runtime_image::PngDecoder> decoder_;
  bool begin_decode(size_t) { ++jpeg_calls; return true; }
  bool select(size_t total_size) {
${cpp.slice(start, end)}
    return decoder_ready;
  }
};
int main() {
  test_favorite_cache();
  test_thumbnail(272,272); test_thumbnail(272,136); test_thumbnail(136,272); test_thumbnail(1,1);
  using esphome::online_image::allowed_cover_redirect;
  using esphome::online_image::compatible_cover_url;
  assert(compatible_cover_url("https://cdn-profiles.tunein.com/s106736/images/logog.jpg?t=151324") ==
    "https://cdn-profiles.tunein.com/s106736/images/logod.jpg");
  assert(compatible_cover_url("https://cdn-profiles.tunein.com/s87683/images/logog.png?t=1") ==
    "https://cdn-profiles.tunein.com/s87683/images/logog.png?t=1");
  const std::string proxy = "https://sali.sonos.superhi.fi/image?w=60";
  const std::string logo = "https://cdn-profiles.tunein.com/s87683/images/logog.png?t=1";
  assert(allowed_cover_redirect(proxy, logo));
  assert(allowed_cover_redirect("https://sali.sonos.radio/image", logo));
  for (auto target : {"http://cdn-profiles.tunein.com/logo", "https://cdn-profiles.tunein.com.evil/logo",
    "https://cdn-profiles.tunein.com@evil/logo", "https://192.168.0.1/logo", "/logo", "//evil/logo"})
    assert(!allowed_cover_redirect(proxy, target));
  assert(!allowed_cover_redirect("http://homey.local/", logo));
  assert(!allowed_cover_redirect(logo, logo)); // No redirect chain.
  assert(!allowed_cover_redirect("https://sali.sonos.radio.evil/image", logo));
  Image png; png.png_response_ = true;
  assert(png.select(52698));
  assert(png.decoder_ && png.total_size_ == 52698 && png.decoded_bytes_ == 0 && png.jpeg_calls == 0);
  assert(!png.decoder_->is_finished());
  png.decoder_->png.done(&png.decoder_->png);
  assert(png.decoder_->is_finished());
  Image chunked; chunked.png_response_ = true;
  assert(chunked.select(0) && chunked.total_size_ == 0);
  runtime_image::PngDecoder::fail = true;
  assert(!chunked.select(0));
  runtime_image::PngDecoder::fail = false;
  Image jpeg; assert(jpeg.select(100) && jpeg.decoder_ && jpeg.total_size_ == 100);
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-cover-formats-'));
try {
  fs.writeFileSync(path.join(dir, 'test.cpp'), source);
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', path.join(dir, 'test.cpp'), '-o', path.join(dir, 'test')]);
  execFileSync(path.join(dir, 'test'));
  const yaml = fs.readFileSync(path.join(root, 'esphome/packages/music.yaml'), 'utf8');
  for (const fragment of ['(i % 3) * 150, (i / 3) * 48', 'lv_obj_set_size(button, 146, 44)',
    'lv_obj_set_size(title, 98, 30)', 'lv_obj_set_size(cover, 32, 32)',
    'y + 44 <= 0 || y >= height']) {
    if (!yaml.includes(fragment)) throw new Error('Missing compact/visible favorite layout: ' + fragment);
  }
  const schema = fs.readFileSync(path.join(root, 'esphome/components/online_image/image.py'), 'utf8');
  if (!schema.includes('lv_defines.add_define("LV_DRAW_SW_SUPPORT_RGB565A8", "1")'))
    throw new Error('Opaque RGB565 cover scaling requires RGB565A8 renderer support');
  if (!cpp.includes('this->parent_->get(compatible_cover_url(target), std::vector<http_request::Header>{},')) throw new Error('Redirect must not forward request headers');
  if (!yaml.includes('signature == previous_signature') || !yaml.includes('lv_obj_scroll_to_y(id(music_favorites_grid), scroll, LV_ANIM_OFF)') || yaml.includes('id(favorite_artwork).clear();'))
    throw new Error('Favorites must preserve unchanged widgets, cached covers and scroll position');
  for (const fragment of ['descriptor->header.stride =', 'lv_image_cache_drop(descriptor)',
    'lv_image_set_src(id(music_cover_widget), static_cast<const void *>(nullptr))',
    'lv_image_set_src(id(small_music_cover_widget), static_cast<const void *>(nullptr))',
    'for (auto *button : {id(small_music_room_select),']) {
    if (!yaml.includes(fragment)) throw new Error('Missing cover/group safeguard: ' + fragment);
  }
  console.log('PASS: PNG/JPEG decoder selection, chunked PNG initialization, preparation failure, shared-buffer and compact-label safeguards');
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
