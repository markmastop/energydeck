# Price source fallback

Install the updated `homeyscript/energydeck-prices.js` in the existing HomeyScript. No firmware change is required. Homey's internal prices remain primary; failed, invalid or incomplete days are requested independently from Energy-Charts (`/price?bzn=NL&start=DATE&end=DATE`). A missing tomorrow never blocks a valid today. If both sources fail for today, the existing variable is not overwritten; the deck's date validation prevents stale data being shown as current.

The reserve validates the unit, finite prices, matching timestamps, Amsterdam date, 96 consecutive actual quarter-hours and local midnight boundaries. It converts EUR/MWh to EUR/kWh only. Taxes and supplier fees remain exclusively in the deck. The current 96-slot display cannot represent DST days with 92/100 actual quarters; the fallback rejects those rather than fabricating data.

The returned `sources` map and warnings identify fallback use. Attribution: Energy-Charts API, https://api.energy-charts.info/ ; NL data from Bundesnetzagentur | SMARD.de, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Values are converted to EUR/kWh. Preserve this attribution when reusing the data.

Live testing returned 96 quarter-hour NL prices with `EUR / MWh` units, but the explicit 2026-09-08 request returned HTTP 404. A reserve source cannot supply unpublished data. Run `node scripts/test-price-bridge.cjs` for mocked source failures, conversions, invalid data and date handling.
