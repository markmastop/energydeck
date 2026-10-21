# Energy history graphs

The Energy detail page keeps the shared live header and shows two non-scrolling
charts for today's local calendar day. Electricity uses paired blue import and
green export bars, in kWh per hour. Gas uses pink bars, in m3 per hour. The current
hour is incomplete. Future hours and missing/invalid intervals stay empty; a
one-pixel bar represents a measured zero. Each chart scales independently, with
the upper bound displayed at the top right. Repeated DST hours share an hour slot.

## Homey source and access

The configured HomeWizard P1 device supplies these Homey Insights logs:

- `meter_power.imported`, in cumulative kWh;
- `meter_power.exported`, in cumulative kWh;
- `meter_gas`, in cumulative m3.

Enable **Insights read only** (`homey.insights.readonly`) for the local API key.
No Energy report scope or HomeyScript bridge is needed. Existing read permissions
for devices, price Logic variables, location and Flow listings remain necessary
for the rest of EnergyDeck. Keep the existing explicitly authorized Flow-start
permission for the charging button. Never commit the key from `.env`.

The documented Insights endpoint is
`GET /api/manager/insights/log/:uri/:id/entry?resolution=today`.
On this Homey Pro, `uri` is `homey:device:<device-id>` and `id` must be the **full**
log ID returned by Homey: `homey:device:<device-id>:<capability>`.
Using just the capability returns 404. References:
[Homey local Insights API](https://athombv.github.io/node-homey-api/HomeyAPIV3Local.ManagerInsights.html).

Read-only verification on 2026-10-21 confirmed all three logs with five-minute
cumulative values, starting at local midnight. These values are Homey's averaged
samples, so their differences give a historical estimate rather than exact
billing interval readings. Displayed current/day summaries in the shared header
continue to use their existing sources.

## Calculation and polling

Differences use double precision to retain small changes in large cumulative
counters. A five-minute difference belongs to the interval ending at its timestamp
(the 01:00 reading closes the 00:00 hour). UTC timestamps are converted separately
with ESPHome's configured timezone; coverage counts real elapsed intervals through
DST. Missing intervals, non-numeric samples and counter resets invalidate the
hour rather than creating a low bar or spike. Duplicate/out-of-order entries are
ignored. The history is rejected if its latest valid point is over 15 minutes old.

The page paints before fetching. Opening Energy starts one single-flight script
with three sequential read-only requests, bounded at 32 KiB each and separated
by 80 ms. Fresh complete responses are reused on repeated opens for four minutes.
While Energy is visible, a five-minute timer requests refreshes; no history
requests run just because the main dashboard is open. Each failed series clears
independently; the electricity status identifies partial availability. Cached
series expire after 15 minutes and are hidden immediately across local midnight.
Existing background HTTP timeout/worker limits remain unchanged. No charging,
thermostat or playback commands are sent by this feature.

## Verification

`c++ -std=c++17 -Wall -Wextra -Werror scripts/test-energy-history.cpp -o /tmp/test-energy-history`
and `/tmp/test-energy-history` cover precision, known zeros, gaps, resets,
duplicate/out-of-order samples, repeated DST hours, date rollover and expiry.
Simulator and hardware builds and actual LVGL layout rendering are also required.

### 2026-10-21 validation

Both target builds passed. The actual Energy-page YAML and production LVGL chart
renderer were visually checked with the real retrieved P1 histories. The history
model tests, production LVGL bars/gauges tests, existing energy-state tests and
climate source/navigation checks passed. Read-only checks with the new token also
confirmed continued access to the P1 device, Evohome controller and price bridge.
The 5-inch upload passed flash hash verification. Physical touch navigation and
history loading on the physical display have not been manually verified.

The serial boot check confirmed build `2026-10-21 21:14:08 +0200` and
`Controller Automatisch: 9/9 zones valid, demand state 1`.
