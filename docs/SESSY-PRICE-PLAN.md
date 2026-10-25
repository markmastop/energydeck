# Forward-looking Sessy charge and discharge plan

Status: design proposal and offline visual example. **Not installed in Homey.**
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
