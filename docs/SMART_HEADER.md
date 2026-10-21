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

The three permanently positioned icons between price and gauges have no text:
heating (pink), EV charging (blue) and battery activity (green, with a direction
arrow). The roughly 20 px icons use a compact 24 px vertical pitch, centered
beside the gauge row. Inactive or unknown states stay dim. Charger faults or
disconnection never light the charging icon. Icon colors only change when their state changes.

Heating is never inferred from gas usage, setpoint or indoor temperature.
A recognized `thermostat_state` value (`heating`, `idle`, `off`) is required on the
configured controller. The local EvoTouch exposes a programme but **no actual
heating state**, so its flame stays dim and Climate explicitly reports unknown
heating status. Adding a confirmed boiler signal remains separate work.

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

Climate shows the controller programme, actual heating status when supported,
and six room cards with measured and target temperatures. Temperature sensors
remain the existing optional `HOMEY_CLIMATE_SENSOR_*_DEVICE_ID` sources. If a
room sensor is unavailable, a fresh measured temperature from that same room
thermostat is used; if both are unavailable the value stays `--`. Configure
`HOMEY_THERMOSTAT_DEVICE_ID` for the controller and optional
`HOMEY_ROOM_THERMOSTAT_1_ID` through `HOMEY_ROOM_THERMOSTAT_6_ID` for the room targets;
the room numbers match the existing sensor/name slots. See `.env.example`.

All new requests are authenticated read-only GETs through the existing bounded
background worker. Navigation paints first; repeated Climate opens coalesce
polls. The details never change setpoints, trigger charging Flows or send Sonos
playback/grouping commands. The existing explicitly clicked controls retain their
behavior. Climate polling and thermostat polling also defer background artwork.

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
