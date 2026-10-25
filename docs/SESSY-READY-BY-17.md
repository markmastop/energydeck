# Sessy evening reserve: full by 17:00

The user-confirmed battery capacity is **5 kWh**. The existing Homey device
charge limit is **2200 W**; automatic grid top-up uses **1000 W** and plans its
start at that lower power. `homeyscript/sessy-ready-by-17.js` extends the normal
target calculation inside the existing `Sessy - Run` Advanced Flow; it is not
a second independently scheduled controller.

## Behavior

- From **09:00 to 17:00 Europe/Amsterdam**, solar surplus still charges the
  battery, but normal discharge is held at zero to preserve the evening reserve.
- Grid top-up starts when the time remaining reaches the estimated time needed
  at **1 kW** to reach 100%, plus **45 minutes** for tapering/control interruptions.
- During top-up, available solar surplus above 1 kW can still charge the battery
  up to its configured limit (at most 2.2 kW). The 1 kW limit is for automatic
  battery top-up, not a cap on total household grid import. Manual force-charge
  retains its existing power setting.
- Planning assumes 5 kWh usable capacity and a conservative **90% charging
  efficiency**. This is a planning allowance, not measured battery efficiency.
- Once started, top-up stays latched until 100% or 17:00, except for the
  forecast-based solar pause below. Integer SoC changes do not restart charging.
- At 100%, the target becomes zero and the reserve is held until 17:00.
- At 17:00, existing normal control resumes immediately; the forced negative
  target is removed from the smoothing history. A new calendar day clears the
  top-up latch. Winter/summer time follows Amsterdam local clock time.

With no further solar, approximate latest starts are **10:42 at 0%**, **13:29 at
50%**, and **15:09 at 80%**. Solar charging before these points reduces the
remaining deficit and postpones grid charging. This is a solar-first deadline
strategy; it does not select the cheapest grid-price quarters. Deadline top-up
may therefore import at an expensive price.

Reaching 100% is the operational target, not an unconditional guarantee: late
activation, an unavailable/faulted battery, manual overrides, reduced charging
power, or stronger-than-assumed tapering can prevent it. The script refuses to
charge when the reported device is unavailable/faulted, SoC is invalid, or its
configured charging limit is below the planning limit.

## Local sunshine forecast

The existing hourly `fetchExpectedSunshineComingHours` HomeyScript now publishes
local Open-Meteo sunshine intervals to `sessy_sunshine_forecast`. It explicitly
converts seconds to minutes and uses Unix quarter-hour timestamps across midnight
and daylight-saving transitions. The legacy `ExpectedSunshineMinutes` variable
remains available. No extra schedule is added.

The controller considers the remaining next three hours, clipped to 17:00 and
the available forecast. A forecast must be valid, no more than 75 minutes old,
and cover at least 15 minutes. Little sunshine advances grid top-up by up to
60 minutes; sunshine for at least half the window keeps the original no-sun
latest start. Intermediate forecasts interpolate that advance. A sunny forecast
can pause an early top-up while more than 15 minutes remain before the no-sun
latest start. The actual SoC keeps determining that safe start: predicted sunshine
never postpones it. Missing, failed or expired forecasts retain the original
no-sun policy.

Sunshine minutes are not predicted PV kWh. The separate NED-derived day value is
not used for battery control. This policy adds a conservative weather signal
without assuming that sunlight will cover household demand or charge the battery.

## Existing Flow integration

The installer replaces only the normal `sessy_doel_vermogen` smoothing action
with a HomeyScript action. Its success output reconnects to the original sign,
full-battery, discharge-permission and price checks. On script failure, a new
error action sets the target to zero and follows the same existing stop path.
The preceding calculation of battery-independent household demand remains.
Negative target watts mean charging; positive target watts mean discharging.

Manual force-charge, force-discharge and sleep branches retain their existing
behavior and can override the automatic reserve. The existing EV/low-SoC guard
and all device-command cards are retained. The low-SoC guard can briefly stop
charging below 3%; the normal loop reevaluates every ten seconds. Existing
price restrictions on evening discharge also remain, so full at 17:00 does
not imply forced discharge starting exactly at 17:00.

Four Logic variables control/publish the feature:

| Variable | Type | Purpose |
| --- | --- | --- |
| `sessy_ready_by_17_enabled` | Boolean | Set false to restore normal target calculation |
| `sessy_ready_by_17_state` | String | Date and top-up latch; managed by the script |
| `sessy_ready_by_17_plan` | String | Read-only controller snapshot for the display and web card |
| `sessy_sunshine_forecast` | String | Optional validated local sunshine intervals |

Disabling the feature clears the latch on the next normal loop and removes
the forced charging target. The controller does not change price scripts,
notifications, tariffs, device safety settings or control strategies.

## Installation and rollback

Use the existing `.env` Homey address/token and configured Sessy device ID.
The API key needs permission to read devices, edit Logic variables and edit
Advanced Flows. The installer does not expand permissions or change the key.

```sh
python3 scripts/install-sessy-ready-by-17.py          # read-only preview
python3 scripts/install-sessy-ready-by-17.py --apply  # install and enable
python3 scripts/install-sessy-ready-by-17.py --apply --configure-readers
python3 scripts/install-sessy-ready-by-17.py --apply --with-sunshine
```

The `--configure-readers` command also saves `HOMEY_BATTERY_PLAN_VARIABLE_ID` in the local `.env`
without changing credentials. Restart the web server to load it. Rebuild the
display firmware with that configuration; a simulator build does not update
physical displays.

The `--with-sunshine` option updates the existing forecast script in place using
weather coordinates from the local `.env`, verifies its saved source, and stores
a private source backup under `build/homey-backups/`. Its hourly schedule remains.
Restoring the Flow below does not restore the forecast script; its original source
can be recovered separately from that private backup in HomeyScript.

Installation verifies the existing target calculation and battery identity,
creates missing variables (initially disabled), stores a private exact Flow
backup under ignored `build/homey-backups/`, applies the patch, verifies the
saved Flow, and enables the feature. No manual test Flow is triggered; enabling
the installed rule changes the real battery's normal behavior immediately.

To roll back, use the backup printed during installation:

```sh
python3 scripts/install-sessy-ready-by-17.py --apply --restore build/homey-backups/FILE.json
```

This disables the new feature, restores the exact saved Flow and verifies the
read-back. Keep the private backup local; do not commit it.

## Verification and display impact

```sh
node scripts/test-sessy-ready-by-17.cjs
node scripts/test-sessy-sunshine.cjs
python3 scripts/test-sessy-ready-by-17-install.py
```

Tests exercise the production HomeyScript with isolated fake devices and Logic
variables, including full-day no-sun simulations at five starting charge levels
with 500 W tapering during the final 5%, DST, latching, full stop, disable,
rollover, errors, cloudy/sunny/expired forecasts, incorrectly optimistic full-day
forecasts, sunshine units and partial quarters, and preservation of existing Flow guards/manual commands.
Simulation results do not establish real battery completion at 17:00.

The ESP and web app show the same read-only charge-plan card: measured SoC and
battery power, estimated stored energy (`SoC × configured capacity`), the 100%
target time, solar-first/active-top-up/full-reserve/normal/off status, and a
09:00–17:00 timeline. Green indicates the solar-first window, blue the planned
top-up window, and a white marker the current Amsterdam clock time. These are
planning windows, not measured energy-source histories or a guarantee of full
charge. The start stays fixed once top-up begins rather than sliding forward
as SoC rises. Valid forecasts add compact sunshine minutes/window information.
A separate yellow strip above the charging timeline shows each forecast quarter
at its actual clock position. Solid yellow marks mean sunshine is expected; taller marks mean a larger
sunshine fraction within that quarter. Zero-sun quarters use a thin grey mark.
Brief sunny intervals retain a visible minimum height of 3 px; the text shows
the quantitative total in minutes and forecast-window hours. Only forecast-covered
future intervals appear. Outside that horizon the strip is absent, not a zero-sun
prediction. This is weather data, not measured solar power or predicted battery kWh.
The battery uses the original large-percentage card with the EV card to its
right. The EV area has no outer border; its charge button shares the exact
left edge, width and height of Gas/Sonos/Climate, with extra space above Gas.
Vehicle status, charging details and the existing charge/stop button
remain available; the lower cards and shared header stay in place.

The controller publishes version 1 JSON with `day`, epoch-seconds `updatedAt`,
`enabled`, `phase`, `capacityKwh`, `topUpW`, `targetPercent`, `reserveMinute`,
`deadlineMinute` and nullable `startMinute`. Optional `sunMinutes`,
`sunWindowMinutes` and `sunAdvanceMinutes` describe the forecast used.
Optional `sunPeriods` contains at most 16 consecutive intervals with local-day
minute `from`/`until` and sunshine `fraction` in 0–1. Both clients reject malformed
intervals independently, clip elapsed periods and retain the safe charging plan. Invalid
optional forecast data does not invalidate an otherwise valid plan. Consumers validate the schema, the
Amsterdam date and a maximum age of three minutes (up to 30 seconds clock skew).
The ESP polls the configured variable every minute. The web server reads it
through its existing bounded, authenticated Homey worker pool and subscribes
to its Logic updates. Credentials and device IDs are never sent to browsers.

Missing, invalid, stale or previous-day plans show “plan unavailable” and hide
the timeline, while live battery measurements remain independent. Manual
overrides can pause normal control and therefore expire its last plan. A fresh
off snapshot shows “plan off”. Neither client sends battery commands. Rebuild
and explicitly flash physical displays separately when requested.

### Installation verified on 2026-10-25

The feature was installed and enabled in the existing live Flow. Read-back
confirmed exactly one existing calculation card changed and one error fallback
card added; all other cards were unchanged and the Flow reported `broken: false`.
The scheduled normal loop populated today's latch with `toppingUp: false` and
sent a target of -1663 W, matching the live device setpoint/power, at 30% SoC
with solar surplus. No manual charging test was triggered. The first real
deadline completion and behavior without sunlight have not yet been observed;
those scenarios were verified in isolated simulations only.

The same day, grid top-up and deadline planning were reduced to 1000 W at the
user's request, while retaining solar charging up to 2200 W. The updated live
Flow was installed and read-back verified with no additional cards or changes
to existing guards. The scheduled loop remained enabled and healthy. Five
no-sun/taper day simulations still reached full before 17:00 and never requested
more than 1000 W without solar; separate checks cover surplus charging above
1000 W and a lower configured device limit. Real deadline completion remains
unverified.

### Charge-plan card verification

The controller snapshot publication was installed in the existing live Flow;
its real 5 kWh / 1000 W / 17:00 payload was checked read-only. The simulator was
built and its production battery/EV widgets and render lambda inspected through
a native LVGL capture. The web card was inspected in a mobile browser with demo
data. All 80 web tests passed, alongside the HomeyScript simulations, offline
Flow migration tests, native plan validation/expiry/geometry checks and all
nine compact-card navigation combinations. Physical displays were not flashed.

### Forecast and original card verified on 2026-10-25

The updated forecast script and controller were installed and read back from
Homey. One forecast refresh succeeded; the regular battery loop subsequently
published a plan with 8 sunshine minutes over 180 minutes and a 55-minute advance.
This is a changing live snapshot, not a fixed daily start time. No charging Flow
was manually triggered for UI verification.

The original large-percentage battery card and separate EV card on its right
were restored on both clients. The native production widgets/render lambda were
visually inspected, the display simulator built successfully, and all 81 web
tests passed. Forecast/controller simulations, installer tests, native validation
and nine navigation combinations passed. Physical displays were not flashed;
real completion at 17:00 remains to be observed.

### Visual sunshine quarters verified on 2026-10-25

The snapshot now includes the validated quarter-hour sunshine intervals used by
the controller. Read-back from the normal live loop confirmed these intervals
and their deadline clipping; no manual charging Flow was run. Both clients render
a separate yellow forecast row with shared 0–1 brightness mapping. Native LVGL
and mobile demo previews were visually inspected, the simulator built, all 82 web
tests passed, and controller, native validation, installer and nine navigation
checks passed. This presentation revision has not been flashed to physical panels.

### 7-inch sunshine-row rollout on 2026-10-25

The user requested the sunshine-row revision on the physical 7-inch panel.
The device resolved as `energydeck-7.local` / `192.168.1.100` and its ARP identity
matched `[device MAC redacted]`. Firmware based on `50077de`, with the Xtensa literal
placement repair documented in PERFORMANCE.md, built successfully at
`2026-10-25 11:22:39 +0100` (`config_hash=0x60516aaf`). ESPHome acknowledged
`OTA successful` and `Successfully uploaded program` for the 2,042,032-byte image.
The OTA endpoint responded immediately and again 59 seconds after upload.

Native Sonos state-machine regressions and diff checks passed. This build-option
repair is ESP32-specific; the already implemented web sunshine row needs no
matching source change. No physical touch or photograph inspection was performed,
and the 5-inch panel was not updated in this rollout.

### Unframed EV controls verified on 2026-10-25

The ESP EV container is transparent and borderless. Its 124×34 charge button
starts at x=322, y=529, matching Gas/Sonos/Climate at y=579/629/679. Status and
charging details keep their existing controls and handlers. The web equivalent
removes the outer frame and aligns the action across the column. Simulator build,
native LVGL capture, mobile demo inspection, all 82 web tests and nine navigation
checks passed. No charging command was issued and physical panels were not flashed.

### Sunshine contrast correction (2026-10-25)

Read-only Homey data confirmed just 3 sunshine minutes in a 152-minute remaining
forecast. The original translucent row was difficult to see on the photographed
panel. Both clients now use opaque yellow marks for positive sunshine, with a
3–6 px height and grey 2 px zero-sun marks. Outside the forecast stays empty.
No forecast values or charging policy changed.

### Higher blue charge action (2026-10-25)

The charge action moves 6 px upward to x=322, y=523, retaining its 124×34 hit area.
Available start actions stay blue, including after a completed charging session;
the live renderer no longer turns that same action green. Stop remains red and
pending/unavailable states retain their existing guards. The web action uses the
same blue start/red stop distinction. No charging command is needed for this UI change.

## Proposed next step: prices across evening, night and morning

See [the forward-looking price-plan proposal](SESSY-PRICE-PLAN.md) for joint
charging/discharging optimisation, EV protection and the v2 timeline design.
It is a design and offline example; it is not enabled in the running controller.
