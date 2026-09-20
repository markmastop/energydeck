# ESPHome online_image patch

Vendored from the installed ESPHome 2026.8.2 online_image component, under the
included MIT license. The image schema, header and implementation contain local
artwork handling changes.

Homey sends artwork using a chunked HTTP response. ESP-IDF exposes its size as
zero, unlike the simulator's buffered HTTP implementation. Upstream JPEGDEC
decodes the first partial buffer and fails. It also cannot report completion
when its expected file size is zero.

The patch buffers unknown-length JPEGs until EOF plus a terminal JPEG EOI marker,
then decodes once and explicitly finalizes. Reads remain incremental. Compressed
JPEGs are bounded to 512 KiB and chunked transfers to a 15-second deadline; failed
allocation, HTTP reads or decoding take the existing fallback callback.
Known-length JPEGs retain the full-buffer path with the same size bound.

Baseline JPEGs still use JPEGDEC. SOF2/progressive JPEGs use a bounded stb_image
fallback, compiled with only JPEG support (no SIMD, file I/O, HDR or float paths).
The fallback accepts at most 640 pixels per axis, 400,000 pixels total and 512 KiB
compressed input. Its allocations, including headers and temporary reallocation
copies, have a hard 4 MiB ceiling. On ESP32 they use PSRAM only and leave at least
384 KiB PSRAM free; unavailable memory produces the ordinary image-error fallback.
Input and the final resized RuntimeImage buffer are additional to this budget.
The full RGB output is copied directly into the resized destination and freed
before returning. Decode runs synchronously with bounded dimensions; latency on
the actual deck still needs measurement. No claim of non-blocking decode is made.

`stb_image.h` v2.30 is unmodified upstream source from
https://github.com/nothings/stb/commit/013ac3beddff3dbffafd5177e7972067cd2b5083
(SHA-256 `594c2fe35d49488b4382dbfaec8f98366defca819d916ac95becf3e75f4200b3`).
Its MIT/public-domain license is included in the header.
Run `node scripts/test-progressive-jpeg.cjs` for offline synthetic image tests
under ASan/UBSan, including allocation failures and recovery. Optional command-line
JPEG paths additionally test local real-world fixtures without network access.

PNG responses are selected by Content-Type, regardless of the configured JPEG
default. PNGLE's completion callback handles chunked PNGs and rejects unfinished
images; PNG transfers also have a 512 KiB / 15 second limit. The UI detaches both
cover widgets before decoding and invalidates LVGL's cache before reattaching.
Code generation also enables `LV_DRAW_SW_SUPPORT_RGB565A8`: LVGL 9 requires it
alongside RGB565 support when scaling opaque RGB565 covers. Without it, decoding
succeeds but the transform renderer rejects color format 0x12.

Sonos radio proxies may return a redirect to TuneIn's image CDN. The downloader
allows one HTTPS hop from the two approved Sonos proxies to
`cdn-profiles.tunein.com` only, with no forwarded headers. Shared-client automatic
redirects stay disabled.

Remove this override when an upstream release includes equivalent handling.
Run node scripts/test-chunked-cover.cjs for offline branch tests.
