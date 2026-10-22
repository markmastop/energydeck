# Shared smart header and detail pages

The dashboard, Sonos, Energy and Climate pages use the same live header object.
Navigation reparents that object; it does not duplicate widgets, values or polls.
The existing lower dashboard cards remain available when returning from detail.
The right-hand buttons open Energy, Sonos and Climate respectively.

## Gauges and status icons

- Blue: current grid import/export in kW. A zero tick at 12 o'clock anchors
  the directional arc: export fills left, import fills right. The smaller value
  is **net electricity today**, because the configured Homey summary supplies a net day total, not
  separate daily import and export totals. It must not be labelled as gross
  consumption or as a separate returned total.
- Pink: current gas rate in m3/hour while gas is used; otherwise today's gas
  volume. The smaller value is today's volume during use, yesterday's otherwise.
  The instantaneous source is HomeWizard P1 `measure_gas`, verified locally in
  m3/hour. The summary device's `measure_gas` is in litres/minute and is not used
  as an hourly rate.
- Green: PV production while producing and the battery is charging/idle; battery
  percentage when discharging or when there is no solar production. The smaller
  lines retain the other source and the battery's absolute power with a down
  arrow for charging or up arrow for discharging. Sessy reports charging as
  negative power and discharging as positive power. In battery view the arc
  shows **power**, not percentage: charging fills left from 12 o'clock and
  discharging fills right, with the same zero tick. The number remains SOC in
  percent and standby leaves both halves empty. Solar view retains its normal
  production arc and hides the directional zero tick.

Mode changes require ten seconds of sustained readings. Grid direction has a
50 W deadband; gas becomes active above 0.005 m3/hour. PV production and battery
source switching use 50 W thresholds. During an unconfirmed grid direction change
its title temporarily reads Grid, so the direction label cannot misrepresent the
instantaneous value. The power arcs react directly to the signed reading even
while the title/source mode is debounced. Ring reference ranges are 5 kW per
direction for grid/battery, 5 kW PV, 3 m3/hour active gas and 10 m3 daily gas; they are not goals or limits.

The three permanently positioned icons between price and gauges have no text.
Their roughly 20 px drawings use a compact 24 px vertical pitch beside the gauges:

- Car: gray when disconnected/unknown, blue when connected, green when charging.
  A disconnected or faulted charger never produces a green charging icon.
- Heating: gray when off/unknown, green when the programme is enabled without
  room demand, orange when an Evohome zone requests heat. Orange is inferred
  demand, not confirmed burner activity; see `CLIMATE.md`.
- Battery: blue while charging, green while discharging, gray in standby or when
  power is unavailable. The outline contains a proportional horizontal SOC fill
  from 0 to 100%, in the same color, without a number or direction glyph. A fresh
  SOC remains visible in gray during standby; missing/stale SOC leaves it empty.

Icon colors and battery fill update only when their displayed state changes.

Heating programme and room demand are derived only from the EvoTouch controller
and its Evohome zones. The mode establishes off/enabled; zone measured/target
temperatures establish inferred demand. Labels, generic room sensors, gas usage
and assumed burner signals are not used. Unknown/stale data never implies idle.
Actual boiler firing is not available through these devices.

Live energy readings expire after 45 seconds, room/controller readings after
three minutes and day summaries after 20 minutes. Transport/HTTP/parse failures
clear the affected state immediately. Daily cached readings also expire when the
local calendar day changes. Missing readings display `--`; unknown demand is
never rendered as zero.

## Energy

The page shows site demand, grid direction, solar generation, battery state and
EV charging, followed by net electricity, solar yield and gas totals today.
Site demand includes EV charging and excludes battery charging:

`demand W = grid import W + solar W + battery discharge W`

The readings are polled sequentially, so this is an approximate instantaneous
balance. Missing/stale inputs or a negative balance show `--` rather than an
invented zero. No historical time series is manufactured from the current values.

## Climate

The main view defaults to the nine-room Evohome preview. Climate detail shows the
controller programme and all nine room temperatures/setpoints without scrolling.
Only EvoTouch/Evohome device GETs are used; the old auxiliary sensor reads and
separate thermostat polling loop have been removed. Configure the controller and
nine `HOMEY_ROOM_THERMOSTAT_*_ID` slots in `.env`; optional corresponding `_NAME`
values customize room names. See `CLIMATE.md` and `.env.example`.

One coalesced read-only poll runs every 30 seconds and on explicit Climate opens,
using the bounded worker. It never reads the user's heating labels, changes
setpoints, triggers charging Flows or sends playback/grouping commands. Sonos
polling preserves a deliberately selected Climate preview.

## Verification

Build the simulator and hardware with the normal project environment. Run:

```sh
c++ -std=c++17 -Wall -Wextra -Werror scripts/test-energy-state.cpp -o /tmp/test-energy-state
/tmp/test-energy-state
node scripts/test-music-controls.cjs
node scripts/test-climate-priority.cjs
.venv/bin/python scripts/test-sonos-room-widgets.py
.venv/bin/python scripts/test-energy-gauges.py
```

Inspect the simulator on all four pages, including live solar, battery, gas and
missing values. Hardware upload remains a separate explicitly requested action.

## 5-inch rollout (2026-10-21)

Simulator and 5-inch firmware builds passed. The simulator was visually inspected
with live data on dashboard, Sonos, Energy and Climate, including page/back
navigation, unavailable readings, programme/room targets and the same header.
The final 5-inch build timestamp is `2026-10-21 19:52:14 +0200`.

The serial MAC matched the previously identified 5-inch unit before upload.
The serial upload completed with flash hash verification. A subsequent boot
capture confirmed hostname `energydeck`, the expected build timestamp, Wi-Fi
recovery after an initial connection warning, boot success and repeated Homey
energy/Sessy/charger/Sonos reads. Observed values included 5.093 kWh net electricity,
7.600 kWh solar and 0.885 m3 gas today, battery 2%/0 W and no connected EV.
No crash, error-level entry or watchdog reset appeared in this short capture.
Existing startup timing warnings remain; this is not a long-term stability test.
Physical touch/visual appearance remains user-verifiable; the visual inspection
was performed in the simulator. No real charging, thermostat or playback commands
were sent for verification. The 7-inch was not updated.

The energy-state scenarios, Sonos/model/navigation/control regressions, production
LVGL room-widget/input tests, Climate polling checks, current-price/source tests
and asynchronous UI/network/artwork regressions passed. Two older extraction
harnesses (`test-price-freshness.cjs` and `test-price-window.cjs`) fail both here
and against the unchanged pre-task `homey-live.yaml`: their assumptions about the
price fragment and UI stubs are outdated. Price logic was not changed in this task.

The compact-icon follow-up on 2026-10-21 scales the drawings to 80% and reduces
vertical pitch from 32 to 24 px. Simulator and 5-inch builds passed, the simulator
was visually checked, and the serial upload was hash-verified. The device boot
log confirmed the follow-up build `2026-10-21 20:04:46 +0200`.

The directional-arc follow-up uses a top-center zero for signed grid and battery
power. Production-LVGL tests cover both directions, neutral/unknown values,
saturation and source-mode changes (including zero-to-zero transitions).
Simulator and 5-inch builds passed; visual simulator inspection confirmed import
on the right and an empty battery arc in standby. The serial upload was
hash-verified and the device boot log confirmed `2026-10-21 20:18:08 +0200`.
No charging or battery operation was triggered to obtain those test cases.

The icon-color/SOC follow-up adds separate connected/charging car colors,
off/enabled/firing heating colors and charge/discharge battery colors. The old
in-icon direction glyph is replaced by a proportional SOC bar with no text.
Heating remains unknown on the current controller; no boiler source was inferred
or added. State tests cover colors, freshness and SOC bounds. Simulator and
5-inch builds passed. Native simulator appearance and a standalone rendering of
the actual icon geometry at 0/25/65/100% were visually inspected with synthetic
status cases. The serial upload was hash-verified and the device confirmed build
`2026-10-21 20:32:36 +0200`. No real charging, battery or thermostat commands were
issued for the synthetic test cases.

The Evohome-only nine-zone follow-up removes auxiliary sensor/fallback reads,
uses the EvoTouch programme plus zone measured/target values for inferred demand,
and defaults the main card to all nine rooms. Labels and Flow tags are excluded
from Climate. Simulator and 5-inch builds and state/source/navigation/LVGL checks
passed. The uploaded `2026-10-21 20:51:24 +0200` build reported all 9/9 Evohome zones
valid on the physical device. See `CLIMATE.md` for the visual/navigation check scope.

## Dashboard card buttons

Gas, Sonos and Climate use the same two-step navigation on the ESP and PWA: tapping a different card button shows its compact content on the dashboard; tapping the already selected button opens details. Gas opens Energy, Sonos opens the full player, and Climate opens its thermostat/zones page. Navigation itself does not send device commands.

## 5-inch firmware refresh (2026-10-22)

The connected serial device matched the verified 5-inch MAC `b8:f8:62:7f:06:c8`.
The current `5caaef2` sources were built with `energydeck-crowpanel.yaml` and
uploaded over USB with flash hash verification. The card-navigation check passed
for all nine select/open branches. Serial boot confirmed build
`2026-10-22 08:24:19 +0200`, hostname `energydeck`, and all nine Evohome zones
valid (`Controller Automatisch: 9/9 zones valid, demand state 1`).

This rollout installs existing shared functionality; it changes no ESP or web
behavior. The web app already has the corresponding card-navigation behavior
and needs no source change or restart for this hardware-only update. Physical
touch navigation was not manually tested. No control commands were issued.

## 7-inch firmware refresh (2026-10-22)

The known `energydeck-7.local` device was reachable at `192.168.0.49`; the local
ARP entry matched its verified MAC `14:c1:9f:c3:10:e0`. No USB serial port was
available, so the current `d71c858` sources were built with
`energydeck-crowpanel-7.yaml` and uploaded through ESPHome OTA. The built image
reports `2026-10-22 08:28:36 +0200`; the device acknowledged OTA success. The
card-navigation check passed for all nine select/open branches.

This installs the existing shared functionality and requires no web source
change or restart. No control commands were issued. Serial boot, physical touch
navigation and on-device chart loading were not observed in this wireless-only
rollout.
