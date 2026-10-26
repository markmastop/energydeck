# EV charging proposal

The overview shows a read-only EV proposal between the price and battery graphs on both
web and ESP. Blue quarters are proposed charging windows, grey quarters are
waiting periods, and missing prices remain unfilled. Actual charger connection,
charging, completion and fault state remain separate from this proposal.

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

## Relationship to Sessy and controls

This first stage is a price proposal for review, not a joint energy optimiser.
It sends no Homey or charger commands, does not enforce phase limits and does not
change the battery's forecast. The existing active Sessy controller continues to
protect against feeding an actually charging EV and continues to apply measured
phase/headroom limits. A future actuator integration must reconcile EV permission,
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
