# Display responsiveness

The 5-inch and 7-inch CrowPanel Advance targets share these optimizations:

- 64 KiB data cache, 64-byte data cache lines and 32 KiB instruction cache;
- a 12.5% LVGL draw buffer instead of 25%; ESPHome 2026.8.2 rounds configured
  sizes to 100%, 50%, 25% or 12.5%, so smaller percentages are not smaller buffers;
- clockwise RGB565 rotation in 32 x 32 tiles, using a 2 KiB internal scratch
  buffer rather than strided writes into a full PSRAM rotation buffer;
- one Sonos render/cover update per completed poll, unchanged-text and tab-style
  checks, and battery-header updates on Sessy responses or page transitions;
- global unchanged-value guards across all packages (`set_text`, `set_text_fmt`,
  `set_bar_value`, `set_arc_value`, `set_style_text_color`, `set_style_bg_color`,
  `set_style_border_color`, `set_style_border_width`, `set_pos`, and `set_size`)
  so routine read-only sensor and price polls do not trigger redundant LVGL
  layout recalculations or invalidate unchanged widgets;
- compiler execution speed optimization (`CONFIG_COMPILER_OPTIMIZATION_PERF: y`, `-O3`)
  and inner loop hoisting in tiled portrait rotation;
- a brief cooperative delay before opening-page network requests so the page
  can draw first. Polling frequency and charging commands are unchanged.

The tiled flush uses LVGL's public callback API and the existing RGB display
driver. Touch transforms, colors, page lifecycle and paused-display handling
remain with ESPHome/LVGL. Other rotations and color formats use ESPHome's
original flush callback. The fast path is restricted to the CrowPanel's
`rpi_dpi_rgb` display and its unrotated native 800 x 480 framebuffer.
Although ESPHome emits a generic deprecation warning suggesting `mipi_rgb`,
`rpi_dpi_rgb` is intentionally retained: `mipi_rgb` allocates 32 KiB of internal
DMA SRAM for bounce buffers, whereas `rpi_dpi_rgb` directly reads from the 120 MHz
Octal PSRAM with zero internal DMA overhead, preserving essential internal RAM
headroom for Wi-Fi and TLS network buffers.

## Hardware measurements

Measured on the connected 7-inch ESP32-S3 on 2026-10-12. Each row is the median
of five explicitly invalidated 384,000-pixel dashboard redraws with live
background polling. These are rendering durations, **not** finger-to-screen
latencies or guaranteed durations for every page.

| Configuration | Total redraw | LVGL drawing | Rotation/framebuffer copy |
| --- | ---: | ---: | ---: |
| Original cache and 25% buffer | 1094.7 ms | 314.3 ms | 785.3 ms |
| Larger cache, 25% buffer | 933.1 ms | 158.0 ms | 774.9 ms |
| Larger cache, 12.5% buffer | 667.0 ms | 130.8 ms | 547.8 ms |
| Larger cache, 12.5% buffer, tiled rotation | 229.0 ms | 138.1 ms | 90.5 ms |

Medians are calculated independently per column, so they need not add exactly.
The total redraw improved by approximately 79%. The user confirmed that page
navigation feels clearly faster and that the display, colors and touch work.
The initial rotation optimization was uploaded to the 7-inch device only. Both
devices were subsequently updated on 2026-10-12 with the background Sonos
transport and dashboard-follow changes. The user confirmed image, touch and
automatic room following on the 5-inch.

## Diagnostics and reproduction

`ui_performance` logs render durations above 100 ms. `draw` is total render time
minus synchronous flush time; `rotate/copy` includes the RGB framebuffer copy.
The normal firmware never forces redraws for measurement. The simulator uses
the same diagnostics without the hardware rotation path.

For a deliberate hardware benchmark, compile
`esphome/energydeck-crowpanel-7-benchmark.yaml` using the normal local environment.
Upload only when requested. This target forces five redraws of the current
screen, three seconds apart, starting approximately 33 seconds after boot.
It never clicks controls or starts charging, playback or grouping commands.
Use the same page for comparisons and restore the normal 7-inch target afterward.
Wait at least 60 seconds after OTA boot before deliberately resetting the deck:
ESPHome's boot-success window protects updates against early-reset rollback.
Check the logged build timestamp and buffer size when comparing versions.

Read-only Homey fast polls and Sonos SOAP requests also log their response times
under `network_performance`, without credentials or response bodies. The initial
production check recorded one 2,968 ms Sonos topology request, which exposed a
separate interaction bottleneck after rotation was fixed. Sonos SOAP now runs on
a separate sleeping worker; its log entries include `(background)`. Status
models and UI callbacks stay on the main thread. Ordinary controls release after
acknowledgment and confirm on later snapshots rather than waiting two seconds
and a full read-back cycle. Room rows are retained and updates are deferred during
scrolling. See [Sonos responsiveness details and tests](SONOS.md).

## UI-first background work

Homey, climate, temperature and rain HTTP now use one sleeping background worker,
including the existing charging POSTs. TLS, socket waits and PNG/JPEG decoding
never run in the display loop. On both ESP32-S3 targets, the application task runs
at priority 2 on its normal core; Sonos and HTTP/artwork workers run at priority 1
on core 0. System Wi-Fi/interrupt priorities remain under ESP-IDF's control.

Main-thread publication waits while any LVGL input is pressed or scrolling,
including momentum, and until 150 ms after the last interaction. This applies to
Homey/artwork callbacks and Sonos reply consumption across all pages. Homey
publications are spaced by at least 20 ms; callbacks over 20 ms emit a diagnostic.
Models, scripts and LVGL objects remain owned by the main thread. Long callbacks
and full-screen redraws can still take time; this is not a hard touch-latency bound.

The bounded queue holds at most 32 unsent jobs. Controls precede data, which
precedes artwork, with FIFO ordering within each class. Sent requests are drained
once and never automatically retried. Stopped/restarted scripts discard old
results and cancel unsent requests; script continuations and `script.wait` advance
only after the matching response. Existing charging fallback decisions are
unchanged and are not exercised against real Homey Flows during UI tests.

Data replies keep their configured body limits and an 8-second deadline. Artwork
is capped at 512 KiB compressed and decoded, with a 15-second download deadline
shared across its single allowlisted redirect and a separate 15-second decode
budget. Workers decode into separate buffers and yield to system tasks regularly.
The old displayed pixels remain valid until a complete result is published;
changing the URL or releasing an image invalidates old work. Incomplete, oversize
and failed responses use the existing error/fallback handlers. HTTPS retains CA
and hostname verification, redirects remain disabled for authenticated data,
and artwork redirects forward no headers.

The physical displays put allocations larger than 1 KiB in PSRAM when space is
available, leaving more internal memory for sockets and TLS AES-DMA buffers.
The previous 4 KiB preference also kept many Sonos metadata strings in internal
RAM. A live 5-inch favorite trial captured repeated AES allocation failures from
the background HTTPS worker. The lower threshold addresses that observed memory
pressure; it does not establish that it caused the separate Sonos HTTP timeout.
The dedicated internal reserve increases from 32 KiB to 128 KiB, accounting for
the two background workers' 24 KiB of task stacks and network/crypto allocations
that cannot use ordinary PSRAM. Transport errors report both internal and
DMA-capable free/largest blocks before TLS cleanup releases its allocations.
Hardware AES is disabled on the physical displays: despite the larger reserve,
cover HTTPS still produced an AES allocation failure with 7,811 DMA-capable bytes
free but only a 2,432-byte largest block. Software AES keeps encryption on the
low-priority background worker and avoids the driver's DMA staging allocations.
TLS algorithms, CA/hostname verification and network deadlines are unchanged.
The intermediate 64 KiB reserve still left only 919 DMA-capable bytes free
during an artwork request, with selected-room reads timing out concurrently.
The larger reserve preserves headroom for network buffers while ordinary model
and JSON allocations can fall back to the available PSRAM.

Rooms still defers new artwork throughout the tab. Inventory and selected-room
metadata publish early; selection abandons unsent older Sonos reads, and favorites
Browse pages yield to selection with a 1.5-second read deadline.
The full-screen redraw measurements above describe
the rotation change, not the later background-network changes or command latency.

The 5-inch room-scroll follow-up reproduced a separate input problem in LVGL:
its default button scroll-on-focus starts an automatic scroll-to-view animation
when a partly visible row is touched, competing with the subsequent drag.
Room-choice and membership buttons now disable that flag. A regression using
the production renderer and a pointer device fails before the fix and verifies
that touch-down starts no animation, dragging moves the list without selecting
a room, momentum ends, and an actual tap still selects the correct UUID. This
changes input behavior without adding redraws, polling or network requests.
The accompanying 150-second physical baseline captured no renders exceeding
100 ms, but did capture 34 foreground operations exceeding 50 ms, including a
1,743 ms rain refresh. Those measurements predate the app-wide background HTTP change and do not
measure its effect or the room-focus issue's latency.

Verify the rotation mapping, including partial tiles and nonzero origins:

```sh
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined \
  scripts/test-portrait-rotation.cpp -o /tmp/energydeck-test-rotation
/tmp/energydeck-test-rotation
node scripts/test-music-controls.cjs
```

After building the simulator, run `.venv/bin/python scripts/test-ui-priority.py`
(or `node scripts/test-chunked-cover.cjs`). It links the actual built LVGL,
HTTP/actions and artwork components to a loopback fixture server. It verifies real
pointer clicks and redraws during a delayed request, quiet-window publication,
queue priorities, script completion/cancellation, complete chunked reads, reply
bounds/deadlines, write-once behavior, decoding/colors and stale-image/caching
behavior. It uses synthetic credentials and no external services. The simulator
must be rebuilt after source changes before running this test.

If a future ESPHome/LVGL update changes the flush API, disable the tiled path
with `ui_performance: {tiled_rotation: false}` and rebuild while investigating.

## 5-inch rollout verification

The UI-first firmware from `aa91f5f` was uploaded to the 5-inch over OTA on
2026-10-12. The serial log confirmed the expected build timestamp
`2026-10-12 18:01:31 +0200`, successful setup and the 60-second boot-success
check. The 95-second capture included seven Sonos status cycles and 151
background replies (11–189 ms), plus live Homey, rain and temperature data,
without crash, watchdog or error markers. OTA remained reachable afterward.

Eleven main-thread publication warnings measured 22–107 ms. These callbacks can
still occupy the foreground after input settles; this check does not measure
physical room-switching or touch latency. No charging, playback or grouping
commands were triggered for verification. The 7-inch was not updated in this
rollout.
