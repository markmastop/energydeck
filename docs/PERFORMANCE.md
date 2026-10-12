# Display responsiveness

The 5-inch and 7-inch CrowPanel Advance targets share these optimizations:

- 64 KiB data cache, 64-byte data cache lines and 32 KiB instruction cache;
- a 12.5% LVGL draw buffer instead of 25%; ESPHome 2026.8.2 rounds configured
  sizes to 100%, 50%, 25% or 12.5%, so smaller percentages are not smaller buffers;
- clockwise RGB565 rotation in 32 x 32 tiles, using a 2 KiB internal scratch
  buffer rather than strided writes into a full PSRAM rotation buffer;
- one Sonos render/cover update per completed poll, unchanged-text and tab-style
  checks, and battery-header updates on Sessy responses or page transitions;
- a brief cooperative delay before opening-page network requests so the page
  can draw first. Polling frequency and charging commands are unchanged.

The tiled flush uses LVGL's public callback API and the existing RGB display
driver. Touch transforms, colors, page lifecycle and paused-display handling
remain with ESPHome/LVGL. Other rotations and color formats use ESPHome's
original flush callback. The fast path is restricted to the CrowPanel's
`rpi_dpi_rgb` display and its unrotated native 800 x 480 framebuffer.

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

Homey HTTP and artwork retain their existing synchronous connection/read paths;
they can still cause their own pauses. New artwork connections are deferred while
the Sonos lists are scrolling. The full-screen redraw measurements above describe
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
1,743 ms rain refresh. Those existing synchronous network pauses remain a
separate limitation; they are not proof of the room-focus issue's latency.

Verify the rotation mapping, including partial tiles and nonzero origins:

```sh
c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined \
  scripts/test-portrait-rotation.cpp -o /tmp/energydeck-test-rotation
/tmp/energydeck-test-rotation
node scripts/test-music-controls.cjs
```

If a future ESPHome/LVGL update changes the flush API, disable the tiled path
with `ui_performance: {tiled_rotation: false}` and rebuild while investigating.
