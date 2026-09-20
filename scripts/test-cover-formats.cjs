// Exercise the actual format-selection block without a live speaker or UI.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const cpp = fs.readFileSync(path.join(root, 'esphome/components/online_image/online_image.cpp'), 'utf8');
const start = cpp.indexOf('  bool decoder_ready;');
const end = cpp.indexOf('  if (!decoder_ready)', start);
const decoderStart = cpp.indexOf('class CompletedPngDecoder');
const decoderEnd = cpp.indexOf('\nOnlineImage::OnlineImage', decoderStart);
if (start < 0 || end < 0) throw new Error('Decoder selection block missing');
const source = `
#include <cassert>
#include <memory>
#include <cstddef>
#include "${path.join(root, 'esphome/components/online_image/cover_redirect.h')}"
using std::make_unique;
struct pngle_t { void *user; void (*done)(pngle_t*) = nullptr; };
void pngle_set_done_callback(pngle_t *p, void (*cb)(pngle_t*)) { p->done = cb; }
void *pngle_get_user_data(pngle_t *p) { return p->user; }
namespace runtime_image {
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
struct Image {
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
  using esphome::online_image::allowed_cover_redirect;
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
  Image jpeg; assert(jpeg.select(100) && jpeg.jpeg_calls == 1 && !jpeg.decoder_);
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energydeck-cover-formats-'));
try {
  fs.writeFileSync(path.join(dir, 'test.cpp'), source);
  execFileSync('c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', path.join(dir, 'test.cpp'), '-o', path.join(dir, 'test')]);
  execFileSync(path.join(dir, 'test'));
  const yaml = fs.readFileSync(path.join(root, 'esphome/packages/music.yaml'), 'utf8');
  if (!cpp.includes('this->parent_->get(target, std::vector<http_request::Header>{},')) throw new Error('Redirect must not forward request headers');
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
