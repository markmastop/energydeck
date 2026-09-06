# ESPHome online_image patch

Vendored from the installed ESPHome 2026.8.2 online_image component, under the
included MIT license. Only online_image.cpp differs from that release.

Homey sends artwork using a chunked HTTP response. ESP-IDF exposes its size as
zero, unlike the simulator's buffered HTTP implementation. Upstream JPEGDEC
decodes the first partial buffer and fails. It also cannot report completion
when its expected file size is zero.

The patch buffers unknown-length JPEGs until EOF plus a terminal JPEG EOI marker,
then decodes once and explicitly finalizes. Reads remain incremental. Compressed
JPEGs are bounded to 512 KiB and chunked transfers to a 15-second deadline; failed
allocation, HTTP reads or decoding take the existing fallback callback.
Known-length JPEGs retain the upstream path with the same size bound.

Remove this override when an upstream release includes equivalent handling.
Run node scripts/test-chunked-cover.cjs for offline branch tests.
