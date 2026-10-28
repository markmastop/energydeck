# EV charging proposal

The overview shows a price-based EV plan between the price and battery graphs on both
web and ESP. Blue quarters are proposed charging opportunities; grey quarters wait
for a better price. With fresh, healthy connected-car telemetry, the current or
next remaining proposal is outlined green. Completed sessions, faults, missing
connection data and telemetry older than 45 seconds do not produce green plans.
Only the next window is outlined, rather than suggesting that one connected car
needs every future six-hour window. With the Homey integration below activated, the same windows also determine automatic charger permission.

Solid green marks a quarter in which charging was actually observed, including
manual charging outside the proposed window. It takes precedence over blue/grey.
One observation does not prove continuous charging throughout the quarter or any
energy amount. Observations are kept in bounded session memory independently of
price refreshes; browser reload/sign-out or display reboot clears them. Web and
ESP collect their own observations, so history can differ when one was offline.
Past proposals are never retrospectively marked as planned/charged just because
a car is connected now. Missing prices remain unfilled.

The detail-page legend and web chart titles distinguish green outlines from solid
green. The web charger note also explains the observation lifetime.

## Initial policy

- Select the cheapest consecutive twenty-four quarters (six elapsed hours) separately
  for each local daytime period (08:00–20:00) and night (20:00–08:00).
- A night belongs to its evening date and can span two published price days.
  Never select two windows for the same night just because midnight occurs.
- Use the same canonical quarter-hour prices as the price chart. Constant tax and
  supplier adjustments preserve window ordering; the ESP may rank the underlying
  prices before its existing all-in conversion.
- Use only validated published days. At the edge of available data, select within
  the published portion if it contains at least six consecutive hours. This is
  a provisional opportunity, not a claim about the unknown remaining hours.
- Preserve Amsterdam civil period boundaries across DST. A window always contains
  six actual hours, even when the clock repeats or skips an hour. Ties choose
  the earliest window. Both implementations use the same policy.
- Show the current proposed window or the next one, including its date on web when
  it differs from today and always on ESP. No known current prices means unknown.

The six-hour duration reflects the user’s Volvo charging need. Day/night
boundaries remain initial product assumptions, not inferred vehicle requirements. There is no vehicle SoC, energy request,
departure deadline or completion guarantee, and no daily user input is required.
A car plugged in after its proposed window may have no remaining proposal in that
period. Manual charging remains available through the existing explicit button.

## Relationship to Sessy and controls (initial rollout)

This first stage is a price proposal for review, not a joint energy optimiser.
It sends no Homey or charger commands, does not enforce phase limits and does not
change the battery's forecast. The existing active Sessy controller continues to
protect against feeding an actually charging EV and continues to apply measured
phase/headroom limits. The initial rollout left actuator integration separate from EV permission,
phase limits, manual overrides and the battery plan before enabling automation.

The ESP uses its compact chart footer for the EV proposal and aligned strip in
place of the general cheapest-period footer. The web retains the general price
summary and adds proposal text in the charger card. All new UI copy lives in the
English/Dutch translation files.

## Verification

`npm test --prefix web` includes day/night opportunities, midnight continuity,
negative/invalid prices and 23/25-hour days. `node scripts/test-ev-plan.mjs` compares
the real C++ and JavaScript planners on regular and DST days. Build the simulator
with the normal local configuration before flashing separately when requested.

Verified locally: all 106 web tests passed; web/ESP planner parity passed on a
normal day and both DST transition days; the ESP simulator compiled. Browser
inspection confirmed the aligned lane and charger-card summary on desktop and
320-pixel mobile viewports without horizontal overflow. No deployment, physical
flash, charging Flow or device-control action was performed.

The overview order is prices, EV proposal, battery strategy, then battery legend.
All three plots retain the same horizontal UTC viewport on web and ESP.

The EV proposal now selects six consecutive hours per day/night period. Shorter
edge fragments are not presented as six-hour windows. The separate general price
summary still reports its existing cheapest three-hour period.

Six-hour update verification: 108 web tests, web/ESP planner parity and the ESP
simulator build pass. Contiguous windows include intermediate expensive quarters
when needed; cheaper disconnected fragments are never combined.

## Connection-aware colours, 2026-10-27

Verified: all 110 web tests pass, including stale/faulted/completed connection
states and observed manual charging outside advice. The C++/JavaScript planner
parity check passes on normal and both DST transition days, with additional native
colour-state assertions. The final ESP simulator and 7-inch target compile.
The 7-inch setup frame is 2720 B against a 4096 B budget. A production-LVGL preview
of the EV labels/strip confirms blue, grey, outlined green and solid green without
label overlap. A synthetic browser preview confirms charging marks and no page
horizontal overflow at the requested 320-pixel viewport. No real charging Flow
was triggered.

The identified 7-inch display received the OTA update successfully and returned
via mDNS with the new configuration hash matching the built image. This verifies
firmware identity and network return; physical panel appearance was not inspected.
The web source was updated and tested locally; no web deployment or Git push was
performed.

## Active Homey six-hour permission (2026-10-27)

`EnergieActuelePrijs` now publishes `Energie - EV zesuursplan toegestaan` and a
JSON diagnostic `Energie - EV zesuursplan` from the exact web planner policy.
Only today's and the next Amsterdam calendar day's complete published prices are
used, matching both clients. The isolated test compares every quarter on normal,
23-hour and 25-hour days and checks that the embedded planner matches the web source.
Missing/invalid current prices clear automatic permission. Short price horizons
never produce a window shorter than six elapsed hours.

The existing minute/price-event publisher writes permission before its final
`Energie - Prijsupdate` completion signal, including `evSixHourAllowed` so policy
changes within the current quarter trigger reevaluation. `Auto - Run` uses the
new permission instead of `Energie - Goedkoopste 7 uren`; the old seven-hour
variable remains available for other consumers.

All other Flow cards and connections stay unchanged: connected-car checks,
`Laden_Forceren`, `laden_direct`, actual allow/deny actions, notifications and
session reporting. The configured force button still targets `Auto - Laden
Forceren`; its 01:30 rule is preserved. Overrides can therefore permit charging
outside the six-hour windows or continue beyond their end. Permission cannot
guarantee that a connected vehicle accepts power or finishes charging.

Run `python3 scripts/install-ev-six-hour-plan.py` for a read-only preflight, then
add `--apply` to activate real permission control. It saves the original Flow,
force Flow, publisher and permission flag in a private `build/homey-backups/`
file, verifies source and Flow read-back, and runs the price publisher once to
apply the current policy. It never invokes the force Flow as a test. For rollback,
restore the saved publisher and `flow` fields (`name`, `folder`, `enabled`, `cards`)
through the same Homey endpoints, then run the restored price publisher; keep the
force Flow intact. Do not commit backups containing household/device identifiers.

Both clients already calculate these windows, so no display firmware change or
physical flash is required. The web explanation describes the optional Homey
activation; publishing web changes remains separate from Homey activation.

Activation verified on 2026-10-27 at approximately 21:14 Amsterdam: the installed
publisher returned `ok: true` with six-hour permission false; the connected
charger reported permission false, no charging and 0 W. The calculated next
window was 23:30–05:30. The complete force Flow matched its saved original after
migration. Future window-start charging was not physically observed during this
check. All 110 web tests, current-price/bridge checks, per-quarter Homey/web parity,
C++/web parity and the ESP simulator build passed. No manual force test or
physical display flash was performed.

### Compact overview

The home chart keeps one compact EV window label (date only when the start is
not today), the aligned EV strip, and a short battery-level heading. Color and
measured/forecast line explanations live on the battery detail page; tap the
display chart or use the web chart details button. Action labels and the
tomorrow-price comparison remain on the overview. This changes presentation
only and never triggers charging commands.

Overview EV window, battery-level heading and tomorrow-price comparison use
the same small supporting font as the chart legend (10 px on ESP and web).
