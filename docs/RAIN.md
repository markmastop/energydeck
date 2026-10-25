# Rain forecast

The weather card shows a location-based two-hour Buienradar forecast in five-minute steps. It refreshes every five minutes, independently of Homey, using the configured ENERGYDECK_LATITUDE and ENERGYDECK_LONGITUDE. These coordinates are sent to Buienradar; no Homey credentials are sent. The displayed time range belongs to the last fetched forecast and remains unchanged between refreshes.

The physical CrowPanel has its own boot automation list, replacing the package boot automations. It explicitly starts both external forecasts after Wi-Fi connects and the clock synchronizes (up to 90 seconds), so the first update does not wait for the periodic refresh.

Rain requests round coordinates to two decimal places, matching Buienradar's grid. This avoids a relative redirect that ESP-IDF can reject as a protocol downgrade, preserves HTTPS, and avoids sending unnecessary location precision.

Blue bars show precipitation intensity in mm/h, on a fixed, piecewise-linear intensity scale (Light / Moderate / Heavy). A flat baseline means dry; an unavailable or stale response hides the graph and displays Rain --. The rain summary uses a 0.1 mm/h threshold. Start and end times are local Europe/Amsterdam times.

Source: [Buienradar.nl](https://www.buienradar.nl). [Feed documentation and usage conditions](https://www.buienradar.nl/overbuienradar/gratis-weerdata). Review the provider's permission requirements before commercial or mobile distribution.

The provider code is converted using `10^((code - 109) / 32)`; code zero is explicitly dry. Weather temperature and tomorrow's forecast still come from Homey. Tomorrow's weather icon no longer determines the rain message.

## Temperature outlook

The line below the current weather shows the temperature expected three hours after the last refresh. It uses [Open-Meteo](https://open-meteo.com/) hourly temperature forecasts for the same configured coordinates, refreshed every 30 minutes. Six hourly points are requested; interpolation at the refresh UTC time plus three hours handles midnight and daylight-saving transitions. Missing or out-of-range data displays `--°`. Homey's current weather also refreshes every 30 minutes and remains separate from this model forecast. Coordinates are sent to Open-Meteo without Homey credentials.

The display bands use 0–2.5, 2.5–7.5 and 7.5–20 mm/h, with equal vertical space per band. Values above 20 mm/h remain at the top of the heavy band; the graph never rescales. Two pixels above the maximum rain height remain available for sunshine caps. These are EnergyDeck display thresholds, not a reproduction of Buienradar's axis. Dry samples retain a muted baseline.

## Sunshine alongside rain

Both the display and web weather charts retain the full blue rain column and add a thin yellow cap above it when sunshine is expected in that same interval. Cap width represents the expected sunny fraction, with a two-pixel minimum to keep brief sunshine visible. Sunshine and rain can appear together; one never replaces the other. Dry intervals can also have a yellow cap.

The existing Open-Meteo temperature request also fetches `minutely_15=sunshine_duration`, avoiding an additional external request. According to the [Open-Meteo interval definitions](https://open-meteo.com/en/docs), these values are seconds over the **preceding** quarter hour. Each five-minute rain interval uses a weighted overlap, assuming sunshine is distributed uniformly within that quarter. UTC bounds keep the alignment continuous across midnight and clock changes; labels remain local.

Missing, invalid or more than 45-minute-old sunshine hides only the yellow caps and leaves valid rain visible. Known zero sunshine also has no yellow cap. This weather forecast covers the full two-hour rain window and is independent of the battery planner's 17:00 deadline and Homey charging Flows.

Both weather cards also state the expected sunshine minutes in the next two
hours, including an explicit no-sunshine message for known zero. Missing/stale
data or incomplete two-hour coverage shows an unknown forecast instead. Positive
values round to whole minutes with a one-minute minimum for brief sunshine.
The web uses a separate sunshine summary. The display combines rain and sunshine
in one line above the wider chart, for example `Rain from 14:40 | no sunshine`.
Unknown sources remain independent (`Rain -- | 25 min sun`). Expected rain is
blue, predicted sunshine is yellow and dry/zero sunshine is muted.
The times below the chart explain its horizon without a separate caption. The display replaces
intensity captions with subtle fixed-band guides and uses smaller source text.
This display layout is intentionally ahead of the web layout at the user's
request; the web redesign is deferred. Both still interpret the same forecasts.

The display outlook uses a fixed 10 px font so short dry messages do not dominate
the chart. A physical visual review can use a temporary firmware fixture marked
`DEMO`, including fictional rain and sunshine. Such a fixture must expire after
ten minutes, restore the real source caption and refresh the real rain feed. It
must not change Homey variables, battery planning or real forecast caches. Normal
production firmware does not start a weather demo.

The combined display outlook uses adjacent labels: rain stays blue when expected,
predicted sunshine is yellow, and zero/unknown sunshine stays muted. The former
horizon-label slot remains empty in live mode and shows only a white `DEMO`
marker during previews. Demo firmware uses the same label helper and colors.

The current-weather icon follows Homey's current condition independently of the
forecast. Cloud, rain, snow and fog hide the decorative sun; clear and explicitly
partly cloudy conditions may show it. This prevents a cloudy reading from always
showing a sun icon. The combined outlook refreshes every minute.
