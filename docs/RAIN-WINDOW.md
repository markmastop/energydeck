# Rain window

Rain data is fetched every five minutes (previously every thirty). Other weather and temperature forecasts retain their existing intervals.

The response must begin within ten minutes of the local clock and have consecutive five-minute samples. Completed intervals are removed; the currently active interval remains. Extra bars without forecast data are hidden, not presented as zero rainfall. The final time label uses the actual available horizon. The dry summary no longer promises a full two hours when fewer samples remain.

Midnight differences are normalized modulo 1440 minutes. Network errors and stale responses continue to hide the plot.
