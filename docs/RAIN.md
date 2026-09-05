# Rain forecast

The weather card shows a location-based two-hour Buienradar forecast in five-minute steps. It refreshes every 30 minutes, independently of Homey, using the configured ENERGYDECK_LATITUDE and ENERGYDECK_LONGITUDE. These coordinates are sent to Buienradar; no Homey credentials are sent. The displayed time range belongs to the last fetched forecast and remains unchanged between refreshes.

The physical CrowPanel has its own boot automation list, replacing the package boot automations. It explicitly starts both external forecasts after Wi-Fi connects and the clock synchronizes (up to 90 seconds), so the first update does not wait for the periodic refresh.

Rain requests round coordinates to two decimal places, matching Buienradar's grid. This avoids a relative redirect that ESP-IDF can reject as a protocol downgrade, preserves HTTPS, and avoids sending unnecessary location precision.

Blue bars show precipitation intensity in mm/h, with an automatic scale of at least 1 mm/h. A flat baseline means dry; an unavailable or stale response hides the graph and displays Rain --. The rain summary uses a 0.1 mm/h threshold. Start and end times are local Europe/Amsterdam times.

Source: [Buienradar.nl](https://www.buienradar.nl). [Feed documentation and usage conditions](https://www.buienradar.nl/overbuienradar/gratis-weerdata). Review the provider's permission requirements before commercial or mobile distribution.

The provider code is converted using `10^((code - 109) / 32)`; code zero is explicitly dry. Weather temperature and tomorrow's forecast still come from Homey. Tomorrow's weather icon no longer determines the rain message.

## Temperature outlook

The line below the current weather shows the temperature expected three hours after the last refresh. It uses [Open-Meteo](https://open-meteo.com/) hourly temperature forecasts for the same configured coordinates, refreshed every 30 minutes. Six hourly points are requested; interpolation at the refresh UTC time plus three hours handles midnight and daylight-saving transitions. Missing or out-of-range data displays `--°`. Homey's current weather also refreshes every 30 minutes and remains separate from this model forecast. Coordinates are sent to Open-Meteo without Homey credentials.
