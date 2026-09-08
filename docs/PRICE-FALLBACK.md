# Price source fallback

Each stored day now includes `source`: `homey`, `epexprijzen`, or `unavailable`. Updated firmware displays a yellow warning triangle beside the chart title if any visible day is not confirmed Homey data. Mixed noon-to-noon windows check both days; the Tomorrow tab checks only tomorrow. Older payloads with no source also warn (unknown provenance). Invalid/absent prices use the existing stale-data message, without the source icon. Update both the HomeyScript and firmware for this indicator.

Install `homeyscript/energydeck-prices.js` in the existing HomeyScript. No firmware update is required. Homey remains primary. Missing or invalid days fall back to https://epexprijzen.nl/api/prices, fetched once per script run.

This internal website endpoint supplies raw NL spot prices in EUR/kWh. Unlike the provider-specific /api/v1 endpoint, it excludes taxes and charges. The deck alone applies those. No division by 1000 is applied.

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
