# EnergyDeck background artwork

Based on the installed ESPHome 2026.8.2 online_image schema, under the included
MIT license, with local asynchronous transport and decoder changes.

`http_request_id` now points to the `background_http` component. The field and
`buffer_size` remain compatible with the existing YAML; compressed replies are
always completed on a worker and capped at 512 KiB, independent of buffer_size.
Content-Type selects PNG or JPEG. PNGLE requires its IEND completion callback;
JPEGDEC requires complete baseline JPEG data and a terminal EOI marker.
Progressive JPEGs and malformed/incomplete images use the existing error fallback.
JPEG callbacks use RGB565 to preserve channel ordering across scalar ESP32 and
SIMD simulator paths. Decoded buffers are bounded to 512 KiB and source dimensions
to 4096 on each axis. Downloads and decoding have separate 15-second budgets.

Eleven Dutch stations have bundled 272x272 baseline JPEGs: Qmusic, NPO Radio
2/5/1, Radio 538, Sky Radio, Radio 10, JOE Nederland, Radio Veronica, 100% NL,
and RADIONL West-Brabant. The ten new assets in `station_logos.h` total 95,127
compressed bytes; the existing `radionl_logo.h` adds 16,101 bytes. Wide NPO marks
have white square padding so the existing center-cropped thumbnails retain the
complete mark. Headers/`station_logos.json` record the source URLs, checksums and
encoding settings. To reproduce the new header with Pillow 12.3.0, run
`.venv/bin/python scripts/generate-station-logos.py`; changed source checksums
abort generation and require inspection before updating the manifest.

`station_artwork.h` maps exact registered TuneIn IDs and g/d/q PNG/JPEG image
resources from the profile and legacy logo CDNs, including one encoded query
layer in accepted Sonos/coordinator metadata. Embedded legacy HTTP URLs resolve
locally; they do not authorize HTTP downloads or change the outer-origin rules.
Only the eleven exact local keys are accepted. Assets decode on the same
low-priority worker and use the same guarded publication, scaling and thumbnail
cache as remote covers, without HTTPS or a progressive decoder. Other stations,
regions and foreign/theme stations keep their own artwork; station names are
never used to guess an identity. Compile-time ID checks keep the data registry
aligned with metadata mapping. Assets are pinned rather than dependent on later
CDN format or availability changes.

The worker owns a separate RuntimeImage and never invokes App/watchdog, model,
scheduler, logging or LVGL callbacks. It yields regularly on ESP32. Completed
pixels cross a release/acquire mailbox; the main thread waits for touch/scroll
and the 150 ms quiet window, invalidates the LVGL cache, and replaces the published
buffer. Old URLs/releases invalidate stale work. ETag/Last-Modified and 304 reuse
remain supported. Existing widgets/favorite thumbnails retain their ownership.

LVGL 9's RGB565 scaling path requires `LV_DRAW_SW_SUPPORT_RGB565A8` alongside
RGB565; code generation enables both for opaque covers.

Only one HTTPS redirect from the two approved Sonos proxies to
`cdn-profiles.tunein.com` is allowed, with no forwarded headers and the same
download deadline. Shared automatic redirects remain disabled.

Build the simulator, then run `node scripts/test-chunked-cover.cjs` for actual
loopback HTTP and decoder tests and `node scripts/test-cover-formats.cjs` for
thumbnail colors/cropping, cache ownership and redirect allowlist tests.
`ENERGYDECK_UI_SNAPSHOT=/tmp/station-logos.png .venv/bin/python scripts/test-ui-priority.py`
tests all eleven local assets at 272/92/32 pixels through the production
component/LVGL, checks publication during held input, and exports a visual sheet.
