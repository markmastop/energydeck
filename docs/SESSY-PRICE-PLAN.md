# Forward-looking Sessy charge and discharge plan

Status: planner, shadow integration, ESP/web readers and offline tests implemented.
**Deployed in shadow mode on 25 October 2026; active price control is not enabled.**
The current ready-by-17 controller remains authoritative. This document supersedes
neither its running configuration nor any manual override.

## Objective, agreed constraints and proposed reserves

Plan the household battery across the next evening, overnight charging window,
morning peak and following day. Reaching full at a fixed clock time is no longer
the optimisation objective: energy should be available before valuable consumption
periods, without draining the battery before a later, more expensive peak.

- Battery: 5 kWh. Grid top-up: at most 1 kW, reduced further by measured headroom.
- Actual solar surplus keeps priority and may use the existing 2.2 kW charge limit.
- Discharge supplies household demand only; no deliberate grid export or EV charging.
- Preserve existing device fault, availability, full/empty and manual-control guards.
- Propose a 10% operating reserve; confirm against the device's configured limits.
  A provisional 20% end-of-horizon reserve avoids emptying at the last known price.
- The existing discharge ceiling is 1.8 kW; a ceiling is never a required output.
- Price, weather, energy and SoC readings remain distinct from predictions.

## Inputs and their authority

1. Use the same canonical all-in quarter-hour price feed as the chart, including
   taxes, VAT and supplier fee. Track Homey versus EpexPrijzen fallback provenance,
   publication time and date. Validate complete 92/96/100-quarter calendar days.
2. Read measured SoC, signed battery power, device charge limits and fault state.
   Negative battery targets charge; positive targets discharge.
3. Predict household consumption excluding the EV: initially use robust recent
   weekday/weekend quarter-hour profiles, with confidence bands and missing-data
   handling. Do not train on grid import alone: remove battery effects and EV load,
   and include measured PV to reconstruct the underlying household demand.
4. Use EV power/active state and the actual site connection/phase limits. EV charging
   schedules are predictions; the measured active/unknown state overrides them.
5. Use measured solar surplus immediately. Sunshine minutes are not PV kWh. Until
   a calibrated PV forecast is available, do not subtract invented solar energy
   from the charging requirement. Sunshine can still be displayed separately.

## Rolling planning process

- Rebuild a plan when new price days arrive, and at least every five minutes.
  Replan immediately on material SoC/demand changes, EV start/stop, faults or
  changes to usable headroom. Retain the current ten-second execution loop.
- Consider up to 36 hours, stopping at the end of published, valid prices. Never
  repeat today's prices into an unknown tomorrow. Optimise evening and morning
  together rather than separately reserving the same 5 kWh twice.
- For each quarter, choose charge, hold or discharge. Maintain an energy balance
  through every interval, charging/discharging efficiency, power limits, an
  operating reserve and a justified terminal energy value/reserve.
- Minimise imported-energy cost plus a configurable battery-throughput allowance.
  Charging to discharge later must beat losses and the allowance; small price
  differences alone must not create extra cycling. Efficiency and wear settings
  must be identified as assumptions until calibrated.
- Select only enough charging energy to cover valuable future household demand
  plus the reserve. Night charging need not reach 100% if less is useful; leave
  capacity for credible daytime solar. Allow split cheap quarters, but apply
  hysteresis/minimum dwell and recompute after smoothing so commands do not chatter.
- Give each interval a planned SoC band, action, power ceiling, price and reason.
  Explain reasons as cheap top-up, preserving a later peak, household peak support,
  EV protection, solar surplus, full reserve, or unavailable input.

## EV coordination

| Actual EV state | Sessy discharge | Sessy grid charging |
| --- | --- | --- |
| Charging | Blocked | Up to 1 kW only with confirmed connection/phase headroom |
| Confirmed stopped | Follow the price plan, capped by household demand | Follow the price plan and measured headroom |
| Unknown/stale | Blocked | Pause grid top-up until headroom is confirmed; measured surplus may still charge |

The EV retains priority when both devices compete for headroom. Use a site-wide
margin and per-phase measurements where required; total kW alone cannot prove
phase safety. Do not invent a connection rating or EV charger power limit. If
charging overnight becomes impossible, publish that the morning target is at
risk rather than overriding the ceiling or feeding the car from the battery.

## Integration with the current Homey Flow

Keep `Sessy - Run` as the only actuator writer. Replace its normal planner step,
not its manual force/sleep branches, with the new plan's first actionable interval.
Introduce a disabled-by-default feature flag and a shadow mode that publishes
proposals without changing `sessy_doel_vermogen` or any device command.

The legacy `kwh_prijs_categorie` check currently blocks discharge for categories
containing `C`. Its feed and thresholds must be reconciled with the canonical
quarter-hour prices. Do not leave two contradictory price policies in control:
change only that redundant price gate during the reviewed installation, retaining
fault, SoC, EV and device-command guards. Verify exact Flow changes and save a
private backup before installation.

Do not carry an old force/top-up target into the new interval or a manual-to-auto
transition. Apply discharge caps after smoothing as well as before it, so an EV
start cannot leave a positive trailing command. Restarting must validate persisted
state against the current quarter, real SoC and active overrides.

## Missing inputs and recovery

- Invalid prices: use the existing daytime solar-first/ready-by-17 policy as a
  conservative fallback; do not invent a night-price plan. Existing EV protection
  and SoC limits still take precedence. State the fallback on the card.
- Invalid SoC/device fault: stop automatic battery targets through the existing
  failure path. Unknown forecasts never become a claim of zero consumption/PV.
- Forecast miss: replan from measured SoC; report limited power/energy rather than
  claiming the target is guaranteed. New tomorrow prices extend the horizon.
- Provide one-step rollback to the saved Flow and existing ready-by-17 flag/state.

## Visual contract for display and web

Keep the large **measured** battery percentage, measured power and estimated stored
kWh. Replace the fixed 09:00–17:00 strip with a forward timeline that crosses
midnight and clearly labels the date change. A white marker means now.

Use blue for planned grid charging, orange for household discharge, green only
for actual/calibrated solar charging and a muted track for holding energy. Keep
sunshine forecasts as yellow marks, separate from promised battery energy.
Indicate EV protection with a separate labelled lane/marker, never with an
ambiguous battery phase color. Unknown future intervals stay unfilled.

The compact card shows current action and the next transition, such as `Holding
for evening peak` / `Discharge from 17:30`, then `Night top-up 02:15–04:00` /
`Morning support 06:45–09:30`. These are examples, not fixed schedules. Detail
views show quarter price, planned power, predicted SoC band and the reason. Keep
EV status and its charge control available alongside the battery card.

Publish a versioned v2 read-only snapshot with UTC interval bounds, generatedAt,
validUntil, source status, plan mode, current action, next transition, capacity,
limits, SoC estimate/band, operating reserve and interval action/reason. Readers
reject stale/malformed intervals independently of measured battery data. Preserve
v1 compatibility until both ESP and web readers have been deployed.

## Example and its limits

The accompanying visual uses the already read 25–26 October 2026 quarter prices
(today: Homey; tomorrow: EpexPrijzen fallback) and the user's photographed 78% SoC.
It is an offline illustration starting at 14:15 Amsterdam time, **not live control**.

Illustrative assumptions: household consumption 0.35 kW normally, 0.7 kW in the
evening and 0.9 kW during the morning peak; EV charging 00:00–06:00 with 1 kW of
confirmed spare headroom; no PV energy credited; 90% charge and 95% discharge
efficiency; 3 ct/kWh throughput allowance; 10 Wh optimisation steps. These are
not measured consumption, connection limits, calibrated losses or battery costs.
The 10 Wh discretisation can request slightly less than the 1 kW ceiling.

The example allocates discharge to about 17:30–20:00, reserves remaining energy,
uses selected cheaper late-night/overnight quarters to prepare for the morning,
and supplies household demand around 06:45–09:30. It looks beyond that morning
to the following evening. Exact periods must come from the real forecast/model.

## Delivery and acceptance

1. Reconcile canonical prices, EV state and actual site headroom; obtain the
   household/EV history needed to calibrate the forecast and confirm reserves.
2. Implement a pure planner and replay historical days without real device writes.
   Test flat/negative/missing prices, repeated DST hours, zero/full/low SoC, taper,
   insufficient overnight headroom, EV overnight overrun into the morning peak,
   unknown EV state, manual overrides and price-category conflicts.
3. Publish v2 in shadow mode alongside the running controller. Compare predicted
   versus measured energy, EV blocks and every proposed action over full night /
   morning / evening cycles. Track forecast error, imports and battery throughput.
4. Build the matching ESP and web timelines. Check mobile/desktop, midnight/date
   labels, missing intervals, live-versus-predicted SoC and all four action states.
5. After reviewing shadow results, enable the planner with a recorded backup,
   read-back verification and rollback. Update both physical displays and web only
   after their respective checks. Do not test presentation by starting real Flows.

## Implemented shadow rollout

`homeyscript/sessy-price-planner.mjs` is the pure optimisation engine, shared by
replay tests and the Homey bundle. It operates on UTC intervals (including a
partial first quarter), validated all-in prices, demand, EV, headroom and optional
PV forecasts. It jointly allocates charge/hold/discharge within capacity, power,
efficiency and reserve constraints. A missing terminal reserve is marked at risk.
The execution guard is unit-tested but is **not wired to device commands**.

The existing installer can include a shadow proposal:

```sh
python3 scripts/install-sessy-ready-by-17.py --with-price-plan --with-sunshine --named-script
# Installation only when rollout is requested:
python3 scripts/install-sessy-ready-by-17.py --with-price-plan --with-sunshine --named-script --apply
```

### Visible and testable HomeyScript

`--named-script` installs **Sessy - Laadplan** in the HomeyScript list and changes
only the existing normal-calculation card in **Sessy - Run** to run that script
with argument `control`. Its success/error continuations, zero-target error
fallback, manual branches, EV/SoC/price guards and device commands are preserved.
The installer refuses to overwrite an unrelated script with the same name.
Updates retain the named script's ID. Keep `--named-script` on subsequent updates.
The named invocation uses HomeyScript's standard
[`runWithArg` action](https://github.com/athombv/com.athom.homeyscript/blob/master/lib/flow/actions/RunWithArgAction.js).

Open **Sessy - Laadplan** in HomeyScript and press **Run** without an argument to
test. Default execution (or argument `preview`) reads current Homey inputs and
returns the controller calculation plus grouped future charge/hold/discharge
phases, prices in ct/kWh, signed power in W, expected SoC, EV flags and sunshine
minutes when known. `preview: true` and `writesApplied: 0` confirm preview mode.
No latch, target or published-plan timestamp is written. An API facade intercepts
all Logic writes and exposes no device-command/Flow API to the bundled controller.
Only the explicit `control` argument, used by the normal Flow, forwards the same
Logic writes in their original order. Do not pass `control` for a manual test.

The exact canonical controller and forward-planner code are embedded inside
`homeyscript/sessy-plan-runner.js`; there is no separately maintained test algorithm.
The installer verifies the saved source and runs only the default read-only
preview before migrating the Flow. A failed preview restores the previous named
script, or removes a newly created unused script. Private Flow/script backups are
saved under ignored `build/homey-backups/`. Restoring an older Flow backup also
restores its original inline calculation; the unreferenced named script remains
safe to run in preview mode.

Both ESP and web keep reading the same `sessy_ready_by_17_plan` variable, with the
same v1 envelope/v2 shadow proposal. This packaging change needs no reader layout,
firmware, Coolify variable or web deployment change. It does not change display
transport/startup; the separate startup stack fix resolves the device-side boot
problem described below.

The bundle uses the actual web `priceDay`, `localDay` and `priceDayBounds` source
for the canonical tariff and DST conversion. Configured Homey price/charger IDs
and tariff settings are bound at installation; changing tariffs requires rebuilding
the Homey bundle. It reads the charger and battery and replans at most five minutes
apart, immediately after SoC, EV, input or price changes. Errors remove only the
proposal, retaining the existing controller and error path.

The v2 proposal is nested as `forwardPlan` inside the existing v1
`sessy_ready_by_17_plan` envelope. Old readers continue using v1. New ESP and web
readers prefer a valid v2 proposal, display **Proposal**, and fall back to v1 on a
malformed/expired proposal. The enclosing normal-control snapshot must also be
fresh, so manual control cannot leave a shadow plan looking current. Existing
`HOMEY_BATTERY_PLAN_VARIABLE_ID` is sufficient; no new Coolify variable is needed.

The forward card retains measured SoC, stored energy and power. Its next-transition
label and UTC timeline span the published horizon; subsequent dates are printed
explicitly. Blue is charging, orange household discharge and grey holding. Yellow
sunshine marks are separate, with unknown coverage left empty. Tapping the battery card opens a dedicated detail page on display and web.
The price and signed battery-power plots use exactly the same UTC axis; selection
shows price, action, watts and expected SoC. The EV controls remain intact.

**Calibration still required before active control:** no household history or site
phase-headroom model is installed yet. Shadow proposals explicitly use provisional
350 W baseline / 700 W evening / 900 W morning demand, 00:00–06:00 predicted EV
charging and 1 kW assumed spare headroom. The first EV interval uses the actual
charger state; unknown EV state blocks discharge. These assumptions never authorise
actuation. Optional fresh `sessy_price_inputs` v1 periods may replace these estimates
(`updatedAt`, `validUntil`, `periods` with UTC `from/until`, `houseW`, `pvW`, `ev`,
`headroomW`); proposals remain marked provisional. Missing sunshine is not zero sun.
No sunshine-to-PV-energy conversion is made. The operating/end reserves and loss/
throughput assumptions remain those listed above.

The next activation step needs measured household/EV history, confirmed site/phase
headroom, shadow replay over complete cycles, removal of the redundant legacy price
gate and an explicitly reviewed activation/rollback. The implementation commit did not install those active-control changes or flash
physical displays; the separate shadow deployment is recorded below.

Checks: `node scripts/test-sessy-price-plan.mjs`, existing ready-by-17 and installer
checks, native `scripts/test-battery-plan.cpp`, web tests and ESP simulator build.

The sunshine publisher now requests up to 36 hours through Open-Meteo's documented
`forecast_minutely_15` parameter ([API reference](https://open-meteo.com/en/docs)).
It retains the old three-hour `periods` and legacy total, and publishes a separate
`forwardPeriods` array. Distant missing values truncate that optional coverage;
they never become zero sunshine or break the short-horizon controller. Display
and web show the available next-day sunshine on the same UTC plan axis. Forecast
minutes still do not authorise estimated PV kWh.

## Shadow deployment: 25 October 2026

- Installed the bundled normal-control step and extended sunshine publisher with
  private backups and exact source/Flow read-back verification. `Sessy - Run`
  remains the sole actuator path; its ready-by-17 policy and existing guards are
  retained. No real charge Flow was manually triggered for testing.
- The normal loop independently published a v2 `shadow` proposal covering 133
  quarters using the Homey/Epex all-in price sources. Inputs remain provisional.
- Refreshed only the verified weather script, using its existing HomeyScript run
  endpoint. The cache became valid with 145 forward sunshine quarters; the next
  natural controller cycle included known sunshine in all 133 planned intervals,
  of which 24 had a positive sunshine forecast at verification time.
- Firmware source `b9a118d` was OTA-uploaded successfully to both 5-inch and 7-inch
  displays. Both returned to the network and accepted connections more than
  80 seconds after upload. Physical rendering/touch remains user-verifiable.
- Pushed the implementation to `origin/main`. The public web card markup and
  `battery-forward.js` were deployed; the served module exactly matched the
  committed file. Authenticated production-card rendering was not verified:
  the production access code differed from the local configured code. No access
  codes or authentication settings were changed.

Shadow output is ready for comparison with measured battery behaviour. Enabling
price-based actuation still requires the calibration and reviewed activation
steps above; this deployment does not enable the execution guard.

### Display refresh regression

The first shadow firmware could hide the plan on the second HTTP refresh:
`BatteryPlan::set` shadowed the `version` member with its argument. After a v2
proposal, parsing the next v1 envelope cleared the intervals but left member
version 2 selected, so freshness validation rejected the envelope. The setter now
explicitly resets the member and controller timestamp before proposal promotion.
A native regression covers five consecutive refreshes plus cleared-state recovery;
the exact YAML parser was also replayed against a live 133-quarter Homey response.
The web reader is stateless and unaffected; its seven plan-contract tests pass.
Simulator and both target firmware builds pass.

## Battery detail page

Implemented in `ce25245`. Normal firmware containing this page was OTA-uploaded
to both displays on 25 October 2026 after the startup stack fix below. The web
detail page was published with the percentage-line rollout recorded below.

### Display startup stack fix: 25 October 2026

The web app could read the proposal, but the 5-inch kept showing unavailable
and did not display a newly uploaded diagnostic marker. An exact parser replay
accepted live Homey data, so neither a successful build nor an OTA transfer alone
established that the new application was running.

The generated `setup()` frame occupied 7,872 bytes of the ESP's 8,192-byte loop
stack, leaving almost no room for callers/callees. The explicit
`initial_value: 'energydeck::BatteryPlan{}'` selected the by-value
`GlobalsComponent(T)` constructor and placed a large temporary on that stack.
Omitting this redundant initializer selects in-place default construction, with
identical default member values and no large setup temporary. The normal 5-inch
and 7-inch builds now use 2,720-byte setup frames. The correction is shared by
both hardware configurations and the simulator; web data/layout is unchanged.

`scripts/check-display-stack.py` reads the actual Xtensa `setup()` machine code
and configured loop stack. It rejects frames exceeding half that stack, leaving
space for nested calls. The saved pre-fix object failed at 7,872 bytes; both fixed
targets passed at 2,720. This is a startup-frame check, not a bound on all runtime
stack use.

A temporary encrypted, read-only native log connection directly confirmed the
5-inch MAC, current build time and firmware version after the fix. It then reported
HTTP 200 with a 24,044-byte response, successful v2 parsing of 125 quarters, current
live SoC and `Render known 1`. Subsequent HTTP refreshes also accepted the plan.
The client did not send device commands, service calls or clock updates. Safe
metadata logs are retained under ignored `build/qa/`; no payloads or credentials
were logged. The temporary API configuration/key and earlier UDP diagnostics are
removed from normal firmware. Normal firmware was then OTA-uploaded to both
previously requested display sizes. Both remained reachable after more than a
minute, and the temporary API port was closed. The user then confirmed that the
plan is visible on the 5-inch. Physical rendering on the 7-inch and touch behavior
were not directly verified. Simulator, both target builds, the native plan/parser
checks and nine web plan/detail checks pass.

The target also explicitly requests its first snapshot after clock synchronization,
because its boot list replaces package hooks. Regular polling remains 60 seconds.
Homey scripts, charging behavior and the shared reader contract are unchanged by
this firmware fix. The price proposal remains shadow-only.

### Named-script migration: 25 October 2026

Installed **Sessy - Laadplan** and verified its source by read-back. Its default
live preview returned success, a forward proposal and `writesApplied: 0`. The
normal Flow now calls this script with `control`; a read-back comparison against
the private pre-migration backup confirmed exactly one changed card and identical
success/error continuations, guards and actuator cards. The script's execution
timestamp subsequently advanced through the natural Flow schedule, and a fresh
v1 envelope contained a 129-quarter shadow proposal. No manual control-mode run
or device/charging Flow test was performed. Both readers retain the same contract;
the named-script, planner, controller, migration and 91 web tests pass.

One tap anywhere on the home battery card opens its dedicated page on both clients.
The existing shared header remains present, and the back action returns to overview.
Opening the page does not select another home card, start charging or trigger a Flow.
Detail pages remain protected from automatic card changes and the idle return policy.

The upper plot shows quarter prices in ct/kWh. The lower plot shows proposed
battery power on the same UTC axis, fixed at -2.5 to +2.5 kW: blue negative bars
charge, orange positive bars discharge and grey zero bars hold. Yellow marks show
sunshine independently of battery power. A white selection cursor appears in both
plots; a slider or plot tap selects an interval and displays its price, action,
power and expected ending SoC. Partial quarters and following-day date labels use
elapsed UTC time rather than equally spaced local-hour labels.

The lower plot also overlays a green predicted state-of-charge line, with its
own green 0/50/100% scale on the right. The first point is the initial predicted
SoC; subsequent points use each interval's ending SoC at its UTC end time. This
is independent of the signed-watt scale on the left. Both ESP sizes and the web
detail page use the same points and legend; stale data hides the line along with
the proposal. LVGL retains the point buffer in the static chart object rather
than allocating a large temporary on the task stack.

### Percentage-line rollout: 25 October 2026

Pushed `4222f08` and its preceding local commits to `origin/main`. OTA to both
identity-checked displays succeeded; the 5-inch and 7-inch remained reachable
114 and 75 seconds after their respective uploads. Both generated startup
frames remain 2,720 bytes. This confirms transfer/restart recovery, not direct
inspection of the percentage line or physical touch behavior on either screen.

The automatic web deployment serves `battery-detail.js`, `translations.json`
and `sw.js` byte-for-byte equal to the pushed files, including cache version
`energydeck-shell-v32`. The public asset responses were HTTP 200 with a normal
browser User-Agent. Authenticated production-page rendering was not inspected;
the native LVGL preview, simulator/target builds and web tests were completed
before rollout. No Homey/device command or charging Flow was triggered for this
presentation change.

The current measured SoC/power remain separate. Only a white measured-power point
at now is drawn; no historical actual line is fabricated from future proposals.
The page explicitly labels shadow proposals and provisional inputs, and renders
an unavailable state when v2 data is missing or expires. No Homey write or new
forecast request is performed by opening the page. Native aligned-axis/selection
tests, web model/navigation tests, existing card navigation tests and simulator/
target builds cover the change; local LVGL and responsive web previews use test data.


### Strategy below overview prices

The display and web overview place a compact strategy chart directly below the
price bars. Both plots use exactly the same UTC viewport: the selected calendar
day (including 23/25-hour DST days) or the rolling noon-to-noon price window.
Blue segments mean charging, orange means discharging, and grey means holding.
The green line uses a separate 0–100% scale for predicted state of charge;
yellow marks retain the separate sunshine forecast. A white marker shows now.
Only overlapping proposal intervals are rendered. Partial boundary quarters
interpolate predicted SoC, while periods outside forecast coverage remain blank.
Stale/missing proposals hide the strategy instead of fabricating history. The
proposal/active label follows the snapshot, and the existing battery-card tap
still opens the detailed plan. This presentation does not activate price control.

Validation: native clipping/interpolation geometry checks, 92 passing web tests,
simulator build and an LVGL preview using fixture data. Both 5-inch and 7-inch
firmware builds pass; each setup() frame is 2736 B against a 4096 B guard budget.
Firmware build and visual preview alone do not verify the physical display or
touch behavior.

The user-authorized rollout of `d4a11ec` on 2026-10-25 pushed the change to
`origin/main` and uploaded the normal production images to both displays.
Both OTA uploads reported success. Hostname/MAC checks identified the 5-inch
`energydeck.local` at 192.168.1.100 ([device MAC redacted]) and the 7-inch
`energydeck-7.local` at 192.168.1.100 ([device MAC redacted]). Both devices
recovered their OTA ports after restart. The public web deployment returned
HTTP 200 and byte-identical `app.js`, `battery-plan.js`, `details.css`, `sw.js`
and `translations.json`; the overview also contains the new strategy markup.
These checks establish upload, network recovery and deployed web assets, not
a physical visual/touch check. No charging Flow was triggered for this rollout.


### Overview readability refinement

The strategy strip on the display now has 32 px for the predicted SoC line
(previously 20 px), while the web uses 60 px (previously 35 px). Both retain a
fixed 0–100% scale so small changes are not exaggerated. Five larger time labels
avoid overlap. A compact blue/orange/grey/yellow legend identifies charge,
discharge, hold and sunshine.

The overview battery card no longer repeats the forecast timeline. It keeps live
percentage, status, energy and a text summary of the next action/time, including
the following-day date when needed. Shadow status and EV/risk warnings remain
visible, and tapping still opens the full battery detail page. On the display,
26 px reclaimed from the battery/EV row enlarge the price/strategy card without
moving the lower cards, weather or shared header. Charging controls retain their
button size and aligned column. Legacy v1 snapshots keep status and target text.
This presentation update does not change controller decisions or activate the
shadow plan. It has not yet been pushed or flashed.


Verification: simulator and both hardware configurations compile; setup stack
frames are 2672 B on each target (4096 B guard budget). Native geometry checks
and all 92 web tests pass. An LVGL capture with fixture data verifies the taller
strategy, larger ticks, legend and shortened battery/EV row. Browser visual
inspection was unavailable in this session; physical displays were not flashed.


### Measured SoC history and dashed forecast

The overview and battery detail now read today's actual `measure_battery` history
from Homey Insights. ESP fetches explicitly from the device boot list and after time sync, refreshes
after four minutes and retries missing history every thirty seconds; the web uses the
session-protected, read-only `/api/battery/history` endpoint with a four-minute
cache. Both use the existing Sessy device ID and server/device-only Homey token;
no new Coolify settings are needed and no token enters browser storage.

A solid green line represents measured SoC before now. The dashed green line
represents the current proposal after now and starts at the latest live SoC when
available. Replacing a proposal no longer removes the measured past. This does
not archive earlier proposals or turn proposed actions into execution history.
The existing charge/discharge/hold and sunshine strips remain forecast data.
Historical power and historical price bars are not invented for battery detail;
its shared UTC axis extends to today's local midnight when fresh SoC history is
available. Price/power proposal bars still start at the proposal's own time.

Measurements must be finite percentages from 0 through 100 and lie within the
current Amsterdam calendar day. At most 310 five-minute points cover a 25-hour
DST day. Future, duplicate and invalid data are rejected. Delayed measurements
from today remain visible; only a join to the live reading requires a recent
last sample. Historical
segments skip gaps over fifteen minutes; a fresh last sample may connect to the
live reading at now. Missing history leaves a gap while a valid forecast remains
visible. A stale proposal can disappear without deleting independently fresh
history. Calendar rollover invalidates yesterday's history.

The ESP draws these lines in place instead of allocating a widget per sample.
Forecast dashes are split explicitly because LVGL's software renderer only
supports built-in dashes on horizontal/vertical segments. Persistent history
buffers use in-place globals without a large setup-stack initializer. The
change is presentation/read-only data acquisition; it triggers no charging Flow
and does not activate shadow control. The user-authorized rollout is recorded below.


Verification: all 94 web tests pass, including read-only history acquisition,
percentage bounds, replan-independent measured lines, gap handling, stale data,
clipping, and session protection for the new endpoint. The native geometry test
covers measured/forecast segmentation and an extended history viewport. Simulator
and both hardware builds pass; LVGL fixture captures verify overview and detail.
The new service also returned 237 fresh real Homey points in a read-only check.
No browser visual inspection or physical rollout was performed during implementation.


### Measured-history rollout on 2026-10-25

Commits `44dc6f5` (readability) and `78804dd` (measured history) were pushed through
GitHub Desktop to `origin/main`. The existing production 5-inch and 7-inch images
were uploaded via OTA; both reported `OTA successful` and successful completion.
Hostname/MAC checks matched the same devices documented above. Both recovered
port 3232 after restart. The 2672 B setup frames passed the 4096 B guard budget.

The public deployment returned HTTP 200 with byte-identical `app.js`,
`battery-plan.js`, `battery-detail.js`, `styles.css`, `details.css`, `sw.js` and
`translations.json`. An additional authenticated API check was unavailable:
the locally configured web access code returned HTTP 401. No credentials were
changed or retried. The histories service's real Homey read was already verified
during implementation; this rollout does not establish an authenticated browser
visual check or physical touch validation. No charging Flow was invoked.


### Startup and combined-plot correction

The first physical rollout exposed a startup omission: the production device's
explicit boot list replaces package boot hooks, so the new history package's
12-second hook was not invoked. Both production boot and time-sync paths now
explicitly fetch battery history. A thirty-second scheduler retries when history
is missing and refreshes loaded data after four minutes. Successful responses
are parsed into a permanent staging buffer before replacing measured history;
HTTP or parse errors retain the valid measurements already known for today.
The web follows the same rule and retains same-day history across fetch failures.
Yesterday's data is hidden after local midnight. Old samples are never joined
to now across a gap longer than fifteen minutes.

The overview uses one full-height graph for both concepts: faint blue/orange/grey
background bands indicate proposed charge/discharge/hold, while the solid measured
and dashed forecast SoC lines share its full 0–100% height. Sunshine stays yellow.
A startup regression test checks the production boot list and both time-sync
paths. The exact response lambda, linked against the simulator's actual ESPHome
clock/timezone objects, accepted 239 real Homey points on the 25-hour DST day.
The native history tests and 95 web tests pass. An LVGL fixture preview confirms
the overlapping bands and percentage line; no charging Flow is exercised.


Correction rollout: `b9906eb` was pushed and both normal production displays
reported successful OTA uploads. Device hostname/MAC identity was rechecked;
both OTA ports recovered after restart. Public `app.js`, `battery-plan.js`,
`battery-detail.js` and `sw.js` returned HTTP 200 and matched the committed files.
Both firmware builds and the simulator passed; setup frames remain 2672 B on
both targets. This verifies the corrective upload and network recovery, not a
physical visual/touch inspection. No charging Flow was invoked.
