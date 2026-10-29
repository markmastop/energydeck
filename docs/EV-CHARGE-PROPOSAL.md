# EV charging proposal

The overview shows low-cost EV windows between the price and battery graphs on
web and both ESP displays. Blue quarters show every known low-cost window,
including past windows and disconnected, stale, faulted or completed sessions.
Grey quarters lie outside those windows. The next remaining six-hour window is
filled green only for a healthy connected car that can still charge, with fresh
telemetry (45 seconds). Later windows remain blue until they become the next
proposal. Missing prices remain unfilled. With the Homey integration below
activated, the same windows determine automatic charger permission.

Orange marks a quarter in which charging was actually observed, including manual
charging outside the proposed window. It takes precedence over every proposal.
One observation does not prove continuous charging throughout the quarter or any
energy amount. Observations are kept in bounded session memory independently of
price refreshes; browser reload/sign-out or display reboot clears them. Web and
ESP collect their own observations, so history can differ when one was offline.
Past proposals are never retrospectively marked as planned/charged just because
a car is connected now.

The header car icon uses green when a healthy connected car that can still charge
has a current or upcoming planned window, orange for actual charging (highest
priority), blue for connected without a current charging expectation and a dim
colour for disconnected/unknown. Current charger status and measured power are
shown separately from the neutral low-cost window label. The chart uses solid
fills in every state, so price advice remains visible on small displays. The
detail-page legend, web chart titles and charger note explain these colours and
observation lifetime.

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


## Solid planned windows and orange charging, 2026-10-28

Replaced the thin green outline with a solid green next-window fill. Actual
charging observations are orange, including manual charging outside advice.
Healthy connected waiting quarters are blue; disconnected or unavailable
expectations and unobserved past quarters are grey. The header is green when
that connected session has a current/upcoming plan, orange during actual charging
and blue when no window is known. Completed/faulted/stale telemetry cannot create
a green plan. This changes presentation only; automatic permission and manual
controls are unchanged.

Verification: all 111 web tests pass, C++/JavaScript EV planner parity passes on
regular and both DST days, native energy-state/icon checks pass, and the ESP
simulator compiles. Local synthetic browser checks confirm solid green windows,
orange charging marks/header and green planned header. No charging Flow was run;
no web deployment or physical-display flash was performed.


### 7-inch rollout, 2026-10-28

Firmware from `a73dac2` was built for `energydeck-crowpanel-7.yaml` and uploaded
successfully through ESPHome OTA to `energydeck-7.local`. The target build reports
configuration hash `9d658f9d` and build time `2026-10-28 20:15:57 +0100`.
The startup stack check passes: 2720 B against a 4096 B setup-frame budget.
After reboot the device's mDNS announcement reports the matching configuration
hash, confirming firmware identity and network return. Physical panel appearance
was not inspected. The 5-inch display and deployed web app were not updated.


### Charger-card consistency, 2026-10-28

The web charger card now shares the header's colour decision. A connected session
with a known window shows green, “Charging planned” timing and a waiting-for-plan
subtitle instead of a blue “Next proposal”. Actual charging takes orange priority;
a disconnected car keeps neutral proposal text. The card icon follows the same
state. Dutch and English translations are provided. This web-only card correction
needs no ESP change: the display header and chart already use the agreed colours.

Verified: all 111 web tests pass; a synthetic mobile browser check confirms the
green card icon/timing, planned-window subtitle and matching green header without
horizontal overflow. No charging control, deployment or firmware upload was run.

## Separate charger status and price advice, 2026-10-29

The charger presentation now separates its reported connection/charging status
and measured power from the low-cost window. Power remains explicit when it is
0 W. The web card has a neutral “Low-cost charging window” block; both compact
ESP layouts keep the same price advice above the graph, apart from the status
card. The manual start action is explicitly labelled as force charging. The
existing charging controls and Homey permission policy retain their behaviour.

The shared chart colours now have one meaning on all three clients:

- Grey: a published quarter outside the selected low-cost windows.
- Blue: a known low-cost window, including past windows and completed,
  disconnected, faulted or stale sessions.
- Green: the next remaining window for a healthy connected car that can still
  charge, using telemetry no older than 45 seconds.
- Orange: a quarter with an actual charging observation, taking priority over
  every other colour, including manual charging outside the low-cost windows.

The label describes a low-cost window instead of promising that the vehicle will
charge. A charger-reported completed session retains its blue price window; it
does not imply a measured vehicle state of charge. Missing prices remain
unfilled, and charging observations keep their existing bounded session lifetime.

Verified locally: all 111 web tests pass, including completed/disconnected/stale
sessions and missing charging telemetry. Web/C++ planner and colour-state checks
pass on normal and both DST transition days; the Homey publisher still matches
the unchanged client permission policy. The simulator, 5-inch and 7-inch targets
compile; both physical targets use a 2720 B setup frame against a 4096 B budget.
Synthetic browser checks confirm blue completed/disconnected windows, a green
next ready window, orange charging observations and neutral card timing. Dutch
and English mobile checks show no horizontal overflow at the browser's measured
355 CSS-pixel viewport. Production-LVGL preview/text measurements confirm the
compact card, button, chart label and legend fit in both languages. No charging
Flow, web deployment, Git push or physical firmware upload was performed.
