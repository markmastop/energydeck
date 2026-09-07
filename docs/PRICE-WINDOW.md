# Automatic price window

The Today view keeps 96 quarter-hour bars (24 hours). Before noon, or while validated prices for tomorrow are unavailable, it shows today's midnight-to-midnight prices. From noon onward it automatically shows today 12:00 through tomorrow 12:00 on the next price refresh, provided tomorrow's complete dated price array is valid.

The title and hour ticks identify the shifted window. The white current-quarter marker and current price retain their actual local time. The scale and cheapest three-hour period are computed over the visible window; times wrap at midnight. Tomorrow's separate tab still displays that full calendar day, and the day-average comparison still compares full days.

The existing 15-minute refresh and stale-date checks remain unchanged. No additional Homey requests are introduced. Test the window mapping with `node scripts/test-price-window.cjs`.

Price requests wait up to 90 seconds for a valid synchronized clock. Concurrent boot and SNTP triggers share one pending refresh. If time remains unavailable, the request is deferred without incorrectly classifying the Homey payload as malformed; a later time-sync or scheduled refresh retries it.
