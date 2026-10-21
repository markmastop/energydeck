# Evohome climate overview

Climate reads only the configured Honeywell EvoTouch controller and Evohome zone
parts through Homey's device API. The controller driver must be
`homey:app:com.honeywell:thermostat`; room drivers must be
`homey:app:com.honeywell:zone`. A wrong driver, failed response, missing capability
or invalid reading is rejected. Logic labels, Flow tags, generic room sensors,
gas consumption and other brands are not climate sources.

The controller provides `honeywell_thermostat_mode`: Auto, HeatingOff, Away,
AutoWithEco, Custom and DayOff. HeatingOff is off; the other recognized modes
allow the Evohome programme to operate. An unknown/stale mode stays unknown.
Every zone provides measured `measure_temperature` and `target_temperature`, in °C.

## Nine rooms on both views

The main dashboard opens with a compact 3-by-3 Evohome preview. Every cell shows
its room name and **measured / target** temperature. The Climate detail page shows
all nine rooms in a 3-by-3 grid with measured temperature, setpoint and inferred
room demand, below the controller programme summary. No scrolling is needed.

The weather card below the rooms shows the current outdoor temperature and
conditions, the three-hour temperature trend, tomorrow’s range and the two-hour
rain forecast. Climate and the main dashboard share the same live widgets,
including source credits. Navigation moves them between pages without resetting
the chart, duplicating requests or changing weather refresh intervals.

The default slot names are Woonkamer, Aanbouw, Lieke, Saar, Werk Renate, Werk Mark,
Badkamer, Badkamer vl and Bijkeuken. Configure the nine zone device IDs with
`HOMEY_ROOM_THERMOSTAT_1_ID` through `HOMEY_ROOM_THERMOSTAT_9_ID`; optional
`HOMEY_ROOM_THERMOSTAT_1_NAME` through `_9_NAME` override their displayed names.
The controller uses `HOMEY_THERMOSTAT_DEVICE_ID`. Unconfigured slots are hidden;
there is no fallback to the retired `HOMEY_CLIMATE_SENSOR_*` sources.

The selected main Climate card stays visible when Sonos playback starts or stops.
Explicitly opening Sonos still opens the full player, and Back returns to the
compact Sonos card. Returning from Climate selects the nine-room preview again.
Existing charging and playback controls retain their explicitly clicked behavior.

## Heat demand and icon colors

- Gray: controller off, unknown/stale mode, or insufficient data to establish idle.
- Green: programme enabled and all configured zones have valid measured/target
  temperatures, with no room requesting heat.
- Orange: programme enabled and at least one configured zone is below its target.
  The affected zone is highlighted in orange on both views.

A 0.05 °C comparison tolerance avoids floating-point noise for Homey's normal
0.1 °C temperature precision. **Orange means inferred heat demand, not measured
burner activity.** A room below target cannot establish that the boiler is
continuously firing. HeatingOff overrides all room requests. If one room is
unavailable, a known request in another room can still be shown; without a known
request, missing data cannot be reported as confirmed idle.

## Polling and validation

One single-flight script reads the controller and up to nine zones sequentially,
with 80 ms between requests. It runs every 30 seconds after a 20-second startup
delay. Opening Climate paints the page first and requests a refresh; repeated
taps coalesce with a running poll. The existing bounded background HTTP worker
and 8-second request timeout remain. Sonos artwork defers while this poll runs.
There are no extra requests on returning to the main preview.

Temperatures outside -20 to 60 °C, targets outside 5 to 35 °C and non-numeric or
unavailable values are rejected. Failures invalidate the affected readings
immediately; otherwise readings expire after three minutes. The main and detail
views share the same cached state and refresh it without network writes.

Verification includes energy-state/demand scenarios (including the ninth zone,
HeatingOff override, missing/stale values and float noise), production Sonos
navigation guards, source/polling checks and simulator/hardware builds. All
heating comparisons are read-only; no Flow, boiler or thermostat command is
triggered for testing. Hardware upload remains separately user-authorized.

## 2026-10-21 rollout

Simulator and 5-inch builds passed. The native simulator main preview was visually
checked with live Evohome data; the full nine-card Climate layout was separately
rendered with built LVGL and synthetic data for layout inspection. The headless
state/source/navigation/gauge tests and production LVGL room/input checks passed.
The simulator's automated mouse clicks did not yield a reliable detail-page
transition in this run, so physical touch navigation remains user-verifiable.

The 5-inch upload passed flash hash verification. Its boot log confirmed build
`2026-10-21 20:51:24 +0200` and `Controller Automatisch: 9/9 zones valid, demand
state 2` (orange heat demand). No label variables were read for this change and no
thermostat, charging or playback commands were issued. Existing unrelated sensor
entries in the local environment remain preserved but are unused by Climate.

## Weather footer

The compact nine-room layout and shared weather footer were built for the
simulator and 5-inch target. The actual YAML widgets were rendered using the
built LVGL library with synthetic values to check spacing and readability.
Climate source/navigation checks and the Sonos control regression suite passed,
including weather reuse, return-to-main ownership and room/footer separation.

The connected 5-inch upload passed flash hash verification. Its serial boot log
confirmed build `2026-10-21 20:59:49 +0200` and all nine Evohome zones valid.
Physical touch navigation has not been manually verified for this change.
