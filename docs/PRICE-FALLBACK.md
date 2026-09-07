# Price source fallback

Install `homeyscript/energydeck-prices.js` in the existing HomeyScript. No firmware update is required. Homey remains primary. Missing or invalid days fall back to https://epexprijzen.nl/api/prices, fetched once per script run.

This internal website endpoint supplies raw NL spot prices in EUR/kWh. Unlike the provider-specific /api/v1 endpoint, it excludes taxes and charges. The deck alone applies those. No division by 1000 is applied.

Validation checks finite numbers, timestamp timezones, Amsterdam dates, 96 consecutive quarters and midnight boundaries. Missing tomorrow never blocks valid today. Failure of both sources for today leaves the variable untouched; the deck rejects stale dates. DST days with 92/100 quarters remain unsupported and are rejected.

The result reports source and warnings. Run `node scripts/test-price-bridge.cjs` for regression tests. The endpoint was live-tested with 96 quarters for 2026-09-08 and a first raw price of 0.206 EUR/kWh. Its internal schema and unit contract may change; do not silently accept a different structure.
