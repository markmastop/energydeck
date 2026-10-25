# Automatic price window

The Today view preserves every real quarter-hour: 92 on the spring DST day, 96 on an ordinary day and 100 on the autumn DST day. Bars share the same fixed chart width. Before noon, or while validated prices for tomorrow are unavailable, it shows today's midnight-to-midnight prices. From noon onward it automatically shows today 12:00 through tomorrow 12:00 on the next price refresh, provided tomorrow's complete dated price array is valid.

The title and hour ticks identify the shifted window. The white current-quarter marker and current price retain their actual local time. The scale and cheapest three-hour period are computed over the visible window; times wrap at midnight. Tomorrow's separate tab still displays that full calendar day, and the day-average comparison still compares full days.

Calendar-day boundaries use Europe/Amsterdam. The current-quarter index is elapsed UTC time since local midnight, so the repeated autumn hour has two independent sets of prices. Clock labels skip the missing spring hour. Current-period labels include a UTC/GMT offset on transition days; web bar tooltips do too. A three-hour block always means twelve consecutive real quarters, even when its clock labels span two or four hours. Full-day averages include every quarter.

The noon-to-noon window can also contain 92 or 100 quarters when the transition occurs tomorrow. Its split is the actual local noon of each day, rather than array index 48.

The existing 15-minute refresh and stale-date checks remain unchanged. No additional Homey requests are introduced. Test the window mapping with `node scripts/test-price-window.cjs`.

Price requests wait up to 90 seconds for a valid synchronized clock. Concurrent boot and SNTP triggers share one pending refresh. If time remains unavailable, the request is deferred without incorrectly classifying the Homey payload as malformed; a later time-sync or scheduled refresh retries it.

## Updating an existing installation

Replace the existing HomeyScript with `homeyscript/energydeck-prices.js`, then run
that price-fetch script to refresh the cached day. Rebuild/restart the web app and
install the updated firmware separately. Old firmware cannot render a 92/100-value
day from the updated bridge. If used, also replace `homeyscript/energie-actuele-prijs.js`;
that separate script publishes Logic variables and may trigger dependent Flows,
so do not run it merely to verify the chart. This code change does not upload
firmware, deploy the web app, or edit/run scripts on Homey.

Regression checks: `node scripts/test-price-bridge.cjs`,
`node scripts/test-current-price.cjs`, `node scripts/test-price-window.cjs`,
`node scripts/test-price-source.cjs`, `cd web && npm test`, and a simulator build.
