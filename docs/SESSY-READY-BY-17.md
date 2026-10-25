# Sessy evening reserve: full by 17:00

The user-confirmed battery capacity is **5 kWh**. The existing Homey device
charge limit is **2200 W**. `homeyscript/sessy-ready-by-17.js` extends the normal
target calculation inside the existing `Sessy - Run` Advanced Flow; it is not
a second independently scheduled controller.

## Behavior

- From **09:00 to 17:00 Europe/Amsterdam**, solar surplus still charges the
  battery, but normal discharge is held at zero to preserve the evening reserve.
- Grid top-up starts when the time remaining reaches the estimated time needed
  to reach 100%, plus **45 minutes** for tapering/control interruptions.
- Planning assumes 5 kWh usable capacity and a conservative **90% charging
  efficiency**. This is a planning allowance, not measured battery efficiency.
- Once started, top-up stays latched until 100% or 17:00. Integer SoC changes
  must not repeatedly stop/restart charging.
- At 100%, the target becomes zero and the reserve is held until 17:00.
- At 17:00, existing normal control resumes immediately; the forced negative
  target is removed from the smoothing history. A new calendar day clears the
  top-up latch. Winter/summer time follows Amsterdam local clock time.

With no further solar, approximate latest starts are **13:44 at 0%**, **15:00 at
50%**, and **15:45 at 80%**. Solar charging before these points reduces the
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

Two Logic variables control the feature:

| Variable | Type | Purpose |
| --- | --- | --- |
| `sessy_ready_by_17_enabled` | Boolean | Set false to restore normal target calculation |
| `sessy_ready_by_17_state` | String | Date and top-up latch; managed by the script |

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
```

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

The ESP and web app already display the same real Homey SoC and battery power;
there is no new display control or layout. Both continue showing the resulting
charging/discharging state. No firmware flash or display UI change is needed.

### Installation verified on 2026-10-25

The feature was installed and enabled in the existing live Flow. Read-back
confirmed exactly one existing calculation card changed and one error fallback
card added; all other cards were unchanged and the Flow reported `broken: false`.
The scheduled normal loop populated today's latch with `toppingUp: false` and
sent a target of -1663 W, matching the live device setpoint/power, at 30% SoC
with solar surplus. No manual charging test was triggered. The first real
deadline completion and behavior without sunlight have not yet been observed;
those scenarios were verified in isolated simulations only.
