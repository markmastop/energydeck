# Price source fallback

Each stored day includes `source`: `homey`, `epexprijzen`, or `unavailable`. Each day tab displays its own yellow warning for fallback, missing or unknown-source data, independently of the selected chart window. No warning remains beside the chart title. Active Today is green; active Tomorrow is blue; inactive tabs remain dark. The current-price headline also names the source explicitly, including EpexPrijzen.nl (fallback). It follows today even when tomorrow is selected. Firmware accepts per-day source fields and the older date-keyed sources map; unknown sources remain unknown. Update both the HomeyScript and firmware for source indicators.

Install `homeyscript/energydeck-prices.js` in the existing HomeyScript. No firmware update is required. Homey remains primary. Missing or invalid days fall back to https://epexprijzen.nl/api/prices, fetched once per script run.

This internal website endpoint supplies raw NL spot prices in EUR/kWh. Unlike the provider-specific /api/v1 endpoint, it excludes taxes and charges. The deck and DataVista presentation apply those; stored prices remain raw. No division by 1000 is applied.

Validation checks finite numbers, timestamp timezones, Amsterdam dates, 96 consecutive quarters and midnight boundaries. Missing tomorrow never blocks valid today. Failure of both sources reuses a complete matching cached day, preserving its successful-fetch timestamp. Without a matching cached day, an empty day is stored and validity is false; stale dates are never reused. DST days with 92/100 quarters remain unsupported and are rejected.

The result reports source and warnings. Run `node scripts/test-price-bridge.cjs` for regression tests. The endpoint was live-tested with 96 quarters for 2026-09-08 and a first raw price of 0.206 EUR/kWh. Its internal schema and unit contract may change; do not silently accept a different structure.


## Persisted status and current-price variables

The payload also stores `checkedAt`, per-day `sources`, `homeyAvailable`,
`fetchedAt`, `cachedDays`, and `warnings`. The per-day `source` fields remain for
firmware compatibility. `homeyAvailable` reflects the last fetch attempt, not a
continuous provider health check. A successful fallback still makes prices valid.

`homeyscript/energie-actuele-prijs.js` reads this payload without network access.
It updates these Logic variables only when their values change:

| Variable | Type / meaning |
| --- | --- |
| Energie - Prijzen geldig | Boolean: complete price day usable now |
| Energie - Homey prijzen beschikbaar | Boolean: Homey succeeded for today's last attempt |
| Energie - Prijsbron | Text: Homey, EpexPrijzen, unknown, or none |
| Energie - Laatste prijscontrole | Text: last fetch attempt timestamp |
| Energie - Laatste succesvolle update | Text: successful fetch timestamp for today's prices |
| Energie - Marktprijs EUR per kWh | Number: raw current quarter price, excluding taxes/fees |
| Energie - Gemiddelde marktprijs EUR per kWh | Number: raw daily average |
| Energie - Prijsupdate | Text: stable JSON completion signal, written after all price fields |
| Energie - Prijsinterval | Text: Amsterdam date and start time of the current quarter |
| Energie - Goedkoopste 3 uren | Boolean: current clock hour is in the cheapest three |
| Energie - Goedkoopste 7 uren | Boolean: current clock hour is in the cheapest seven |
| Energie - Prijsstatus | Text: validity, source, cache-use status, or failure reason |

Clock hours are ranked by the mean of their four quarters, ties by earlier hour.
These flags are not a search for the cheapest contiguous three/seven-hour block.
Both daylight-saving transition days are rejected by the current-price script
because the 96-value format cannot safely represent 92/100 quarters. Invalid data
clears validity and both cheap-hour flags but retains the last numeric price;
consumers must check validity before acting. Writes to separate Logic variables
are not transactional. Do not trigger charging from a price change alone.

Run `node scripts/test-price-bridge.cjs` and `node scripts/test-current-price.cjs`.
The Advanced Flow setup is documented in [HOMEY.md](HOMEY.md).


## Auto - Run migration (2026-09-08)

The active Advanced Flow `Auto - Run` now uses `Energie - Prijsupdate` changed
instead of Energy's electricity-price event, and `Energie - Goedkoopste 7 uren`
is true instead of Energy's cheapest-seven-hours condition. The script clears
this flag when prices are invalid, so the existing false branch disables
price-driven charging. Manual `Laden_Forceren` and `laden_direct` checks precede
that condition and keep their original behavior.

`Prijsupdate` is written last on both valid and invalid updates. It includes the
date, quarter, validity, current raw price and cheap-hour flags; corrections within
a quarter can therefore trigger reevaluation even if `Prijsinterval` is unchanged.
Identical repeated updates do not retrigger. It is a completion signal, not a
transaction or lock across multiple simultaneous script runs.

The disabled backup is `Auto - Run (Kopie)`:
`a14d2af2-e809-4e4b-8b82-ae4003163078`.
The active Flow keeps ID `cd25bbee-d532-4ce1-8302-e3dc2b8277c9`.
All 47 nodes and 40 connections were compared through the web UI; only the two
price cards changed. No manual charging test was started. To roll back, disable
the active Flow before enabling the backup; never run both simultaneously.

## DataVista dashboard migration (2026-09-09)

The current-price script also publishes two presentation-only Logic strings:

| Variable | Purpose |
| --- | --- |
| Energie - Dashboardcategorie | C/N/E, matching the EnergyDeck Today graph price range |
| Energie - Dashboardprijs | Source-first current price, daily average and category; or an explicit invalid-price warning |

Category is written before the label. The compact label abbreviates the unit to `ct` (cents per kWh) and uses all-in prices, matching the current EnergyDeck configuration:
`(raw EUR/kWh * 100 + 9.161) * 1.21 + 2.0`. These presentation constants
must be kept aligned with EnergyDeck tariff settings when those change. The
source comes first (`⚠`) so narrow widgets retain the fallback warning.
For example, 0.061 EUR/kWh becomes 20.5 ct/kWh; cached numeric prices remain raw. Categories use the deck's 33%/66% thresholds over its Today graph window.
The deck's minimum-span behavior also applies to flat days. Invalid data shows no old numerical price and uses
the neutral dashboard branch. Neither field changes legacy Sessy control values.

In `Datavista - Set Information` (`14564d69-c3a3-4337-84e3-2bede54f6b22`):

- `widget_kwh_prijs` now combines `Energie - Dashboardprijs` and the existing
  HomeWizard P1 `Vermogen totaal` tag (updated 2026-09-09).
- The five price display conditions read `Energie - Dashboardcategorie`.
- The three category checks for the appliance-use dashboard advice also read
  `Energie - Dashboardcategorie`; the solar-surplus logic stays intact.
- A new `Energie - Dashboardprijs` changed trigger directly runs the widget
  assignment, bypassing the legacy Homey Energy calculations for display updates.

The original price calculation branch remains for legacy consumers including
Sessy. It can still refresh the widget, but that widget now always reads the
new presentation values. Auto/Sessy charging flows were not edited or manually
started. A display-only flow test completed the VC condition and DataVista
status action using Epex fallback data. Existing current-price regressions also
cover display formatting, invalid-cache warnings, source-only changes without
charging signals, negative/zero prices, flat days and update ordering.

## Unified live net-power source (2026-09-09)

DataVista and EnergyDeck now both use HomeWizard P1 `P1_PHFEG76F` for
instantaneous net power. DataVista has an additional HomeWizard power-changed
trigger wired directly to the widget assignment; price changes still refresh it.
EnergyDeck continues polling the same meter every 10 seconds, so the displays
can briefly differ because of refresh timing and the deck's kW rounding.

`Energie - Run Labels` also uses the HomeWizard trigger and total-power tag for
the trend comparison, both arrow labels, and `kwh_vermogen_huidig`. Existing
import/export direction logic and variable consumers are retained. These are
live-power display changes; daily energy/gas totals and appliance-specific
power readings are separate measurements. No charging test was triggered.

## Unified deck price advice (2026-09-09)

`Energie - Dashboardcategorie` now publishes C/N/E using the EnergyDeck graph
thresholds: green through min + 33% of range, red from min + 66%, yellow
between. After noon, complete matching tomorrow prices select the same
noon-to-noon window as the Today tab. Otherwise today's calendar day is used.
The firmware's 0.001 EUR/kWh minimum all-in span is converted with the configured
1.21 VAT multiplier; keep this aligned if tariffs change. The mean displayed
in DataVista remains the calendar-day average. Selecting Tomorrow on the deck
shows that day's graph; it does not change the current-price dashboard advice.

`Energie - Dashboardadvies` is written before `Dashboardprijs`: C means
“Nu apparaten gebruiken”, N means “Zijn de apparaten echt nodig?”, E means
“Beperk energiegebruik”. Invalid prices show “⚠ Geen geldige prijzen” with
the neutral category. The three DataVista status actions read this variable.

The missing status trigger was replaced with `Dashboardprijs` changed. The
status input now fans out to all three category checks. The former Sessy target
power override was removed from this display advice, preventing a conflicting
green recommendation. Existing solar events can still refresh the same advice.
The unused VC/VE price-display branches remain unreachable for the new three
category model. Charging's existing cheapest-hour flags and completion signal
are unchanged: this migration aligns price presentation and advice.

Verified with isolated current-price regressions covering negative/zero prices,
33%/66% boundaries, flat days, rolling windows, missing tomorrow, invalid prices
and source-only changes without charging signals.
