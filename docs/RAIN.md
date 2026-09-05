# Rain forecast

The weather card shows a location-based two-hour Buienradar forecast in five-minute steps. It refreshes every five minutes, independently of Homey, using the configured ENERGYDECK_LATITUDE and ENERGYDECK_LONGITUDE. These coordinates are sent to Buienradar; no Homey credentials are sent.

Blue bars show precipitation intensity in mm/h, with an automatic scale of at least 1 mm/h. A flat baseline means dry; an unavailable or stale response hides the graph and displays Rain --. The rain summary uses a 0.1 mm/h threshold. Start and end times are local Europe/Amsterdam times.

Source: [Buienradar.nl](https://www.buienradar.nl). [Feed documentation and usage conditions](https://www.buienradar.nl/overbuienradar/gratis-weerdata). Review the provider's permission requirements before commercial or mobile distribution.

The provider code is converted using `10^((code - 109) / 32)`; code zero is explicitly dry. Weather temperature and tomorrow's forecast still come from Homey. Tomorrow's weather icon no longer determines the rain message.

## Temperature outlook

The line below the current weather shows the temperature expected in three hours. It uses [Open-Meteo](https://open-meteo.com/) hourly temperature forecasts for the same configured coordinates, refreshed every 15 minutes. Six hourly points are requested; interpolation at the exact current UTC time plus three hours handles midnight and daylight-saving transitions. Missing or out-of-range data displays `--°`. Homey's current temperature remains separate from this model forecast. Coordinates are sent to Open-Meteo without Homey credentials.
