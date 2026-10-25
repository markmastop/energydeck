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
- Once started, top-up stays latched until 100% or 17:00. Integer SoC changes
  must not repeatedly stop/restart charging.
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

Three Logic variables control/publish the feature:

| Variable | Type | Purpose |
| --- | --- | --- |
| `sessy_ready_by_17_enabled` | Boolean | Set false to restore normal target calculation |
| `sessy_ready_by_17_state` | String | Date and top-up latch; managed by the script |
| `sessy_ready_by_17_plan` | String | Read-only controller snapshot for the display and web card |

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
```

The last command also saves `HOMEY_BATTERY_PLAN_VARIABLE_ID` in the local `.env`
without changing credentials. Restart the web server to load it. Rebuild the
display firmware with that configuration; a simulator build does not update
physical displays.

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
python3 scripts/test-sessy-ready-by-17-install.py
```

Tests exercise the production HomeyScript with isolated fake devices and Logic
variables, including full-day no-sun simulations at five starting charge levels
with 500 W tapering during the final 5%, DST, latching, full stop, disable,
rollover, errors, and preservation of existing Flow guards/manual commands.
Simulation results do not establish real battery completion at 17:00.

The ESP and web app show the same read-only charge-plan card: measured SoC and
battery power, estimated stored energy (`SoC × configured capacity`), the 100%
target time, solar-first/active-top-up/full-reserve/normal/off status, and a
09:00–17:00 timeline. Green indicates the solar-first window, blue the planned
top-up window, and a white marker the current Amsterdam clock time. These are
planning windows, not measured energy-source histories or a guarantee of full
charge. The start stays fixed once top-up begins rather than sliding forward
as SoC rises. The EV controls retain their existing behavior next to the more
detailed battery card; the lower cards and shared header stay in place.

The controller publishes version 1 JSON with `day`, epoch-seconds `updatedAt`,
`enabled`, `phase`, `capacityKwh`, `topUpW`, `targetPercent`, `reserveMinute`,
`deadlineMinute` and nullable `startMinute`. Consumers validate the schema, the
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
