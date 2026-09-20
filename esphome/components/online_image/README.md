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
Known-length JPEGs retain the upstream path with the same size bound.
JPEGDEC remains the only JPEG decoder. Progressive JPEGs are unsupported and
use the existing image-error fallback; no stb_image decoder is compiled.

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
