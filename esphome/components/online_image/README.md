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

RADIONL West-Brabant (TuneIn `s106736`) uses the bundled 16,101-byte baseline
JPEG in `radionl_logo.h`, resized to 272x272 from the station's existing logo.
The header records the original source, checksum and encoding settings. Metadata
from an accepted Sonos/coordinator origin maps the two observed logo resources
to the exact `energydeck://artwork/radionl-west-brabant-v1` key. No other local
resource is accepted. This key decodes on the same low-priority worker and uses
the same guarded publication, scaling and thumbnail cache as remote covers,
without HTTPS or a progressive decoder. Other stations retain remote artwork;
other RADIONL regions are not relabeled as West-Brabant. The live CDN returned
baseline images on 2026-10-12; the pinned asset also tolerates future format changes.

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
