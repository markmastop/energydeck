# Climate card

Opening the Climate tab immediately starts a refresh; the 60-second background
interval and 20-second startup delay remain. Single mode coalesces repeated taps
with any refresh already running. The six read-only requests remain sequential,
with 80 ms between rooms (400 ms total deliberate delay instead of 3 seconds).
New Sonos cover/favorite artwork downloads defer while this script runs; an
already-started download is not cancelled. The shared HTTP timeout remains 8 s.

The Climate tab replaces Extra with six read-only temperature readings in two columns. It uses the dedicated room sensors, not radiator setpoints, air-quality sensors or wall-panel temperature readings. Sensor IDs are configurable via environment variables in `.env` (with built-in defaults):

| Room | Environment variable | Default Homey sensor ID |
| --- | --- | --- |
| Living room | `HOMEY_CLIMATE_LIVING_DEVICE_ID` | e5705cd4-ca02-4cdc-816f-4bc5fc4f5432 |
| Extension | `HOMEY_CLIMATE_EXTENSION_DEVICE_ID` | 564a9710-c503-4d04-9996-6c27b5f28157 |
| Lieke | `HOMEY_CLIMATE_LIEKE_DEVICE_ID` | 0d278a3e-aeb7-4cb3-bb2d-131766931482 |
| Saar | `HOMEY_CLIMATE_SAAR_DEVICE_ID` | ed3cdd0e-2562-453a-a381-5c7d72bdf871 |
| Office Renate | `HOMEY_CLIMATE_RENATE_DEVICE_ID` | b4a69ec5-a37b-4617-b490-d4c7b74534b9 |
| Office Mark | `HOMEY_CLIMATE_MARK_DEVICE_ID` | fae4c622-df59-4e18-8722-53fc9eb1cfb0 |

Polling uses six sequential GET requests separated by 80 ms. It never changes thermostats. Missing, unavailable, failed or implausible (-20 to 60 °C bounds) readings show `-- °C` rather than a stale value.

Heating status is explicitly unknown. The inspected Homey thermostats expose `target_temperature`, `measure_temperature` and `alarm_battery`, but no active-heating capability. A setpoint above measured temperature is not proof of actual heating. A confirmed per-room heating signal must be provided before active/inactive icons can be implemented.

The simulator and physical firmware both include this package; flashing remains a separate user-authorized step.
