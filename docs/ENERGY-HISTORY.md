# Energy history lines

The Energy detail page keeps the shared live header and shows two non-scrolling
line charts for today's local calendar day, using Homey's five-minute samples.
Electricity shows net grid **power in kW**: blue above zero for import, green below
zero for export. Segments crossing zero change color exactly at their crossing.
Gas shows a pink **m3/hour rate** line. These are power/rate histories, not hourly
energy volumes or cumulative meter readings. Current/day summaries in the header
retain their existing sources and units.

The power scale is symmetric around a visible zero baseline. Gas starts at zero.
Scale limits appear at the top right. Missing or invalid samples break the line;
future hours remain empty. A measured zero remains a flat line. No smoothing or
interpolated values are added beyond straight segments between consecutive valid
five-minute samples.

## Homey source and access

The configured HomeWizard P1 device supplies these Homey Insights logs:

- `energy_power`: signed net grid power in W, converted to kW;
- `measure_gas`: gas rate already in m3/hour, used without conversion.

The P1's total-power Insights log is named `energy_power`; trying its device
capability name `measure_power` returns 404. Both working logs were verified
read-only on 2026-10-21, including negative power during export. `today` returns
five-minute averages; `lastHour` can return five-second values but is not used by
this full-day view. The previous cumulative-meter hourly charts are replaced.

Enable **Insights read only** (`homey.insights.readonly`) for the local API key.
No Energy report scope or HomeyScript bridge is needed. Keep the existing device,
price Logic, location and charging-button permissions for the rest of EnergyDeck.
Never commit the key from `.env`.

The documented endpoint is
`GET /api/manager/insights/log/:uri/:id/entry?resolution=today`.
On this Homey Pro, `uri` is `homey:device:<device-id>` and `id` is the **full**
returned log ID, `homey:device:<device-id>:<log-name>`.
Reference: [Homey local Insights API](https://athombv.github.io/node-homey-api/HomeyAPIV3Local.ManagerInsights.html).

## Time, memory and polling

UTC timestamps retain their actual elapsed position between local midnight and
the next local midnight. A DST day may contain 23 or 25 hours; repeated hours
stay monotonic instead of drawing backwards. Local 06:00/12:00/18:00 labels are
positioned using the same calendar conversion. Up to 310 samples fit the longest
day. Duplicate/out-of-order entries and invalid rates are rejected. Gaps over five
minutes break the line; samples in the future are ignored. Failed, stale or
previous-day series clear independently. Data expires after 15 minutes based on
both fetch age and the latest source sample.

The page paints before fetching. Opening Energy starts a single-flight script
with two sequential read-only requests, bounded at 32 KiB each and separated by
80 ms. Cached responses are reused for four minutes. A five-minute timer refreshes
while Energy is visible. Opening only the main dashboard does not fetch history.
Existing HTTP worker/timeout limits remain unchanged. No charging, thermostat or
playback commands are issued.

Samples live in persistent storage and are parsed in place, avoiding large stack
buffers. Two LVGL draw callbacks render the lines without allocating hundreds of
widgets. Redraws occur on new responses or cache expiry.

## Verification

`c++ -std=c++17 -Wall -Wextra -Werror scripts/test-energy-history.cpp -o /tmp/test-energy-history`
and `/tmp/test-energy-history` cover signed geometry, exact zero crossings, gas
zeros, missing samples, duplicate rejection, DST positions, date rollover and
cache/source expiry. `scripts/test-energy-gauges.py` checks production chart
callback registration, scale, bounded object allocation and stale-data clearing,
alongside the shared-header arc tests. Simulator/hardware builds and a visual
render with the actual YAML, production draw callbacks and retrieved P1 samples
verify the final layout. Physical touch navigation remains manually verifiable.

### Line-chart validation, 2026-10-21

Simulator and 5-inch builds passed. The actual page YAML and production LVGL draw
callbacks were visually checked with retrieved P1 power/rate samples. The signed
geometry/expiry model tests, chart/gauge LVGL tests and existing climate checks
passed. No Homey writes were performed.

The connected 5-inch upload passed flash hash verification. Serial boot confirmed
build `2026-10-21 21:22:41 +0200` and all nine Evohome zones valid. Physical touch
navigation and history loading on the physical display were not manually tested.

### 7-inch rollout, 2026-10-21

The connected serial device matched the previously verified 7-inch MAC
`[device MAC redacted]`. The `energydeck-crowpanel-7.yaml` target was built from
`e18a5b9` and uploaded over USB with flash hash verification. This includes the
five-minute power/gas lines, shared header and status icons, nine-zone Evohome
overview and shared Climate weather card. The existing 7-inch configuration
reuses the portrait layout with its own `energydeck-7` hostname.

Serial boot confirmed build `2026-10-21 21:27:36 +0200`, hostname `energydeck-7`
and `Controller Automatisch: 9/9 zones valid, demand state 1`. No control commands
were issued. Physical touch navigation and line-chart loading on the physical
7-inch were not manually verified.
