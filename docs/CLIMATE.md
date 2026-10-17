# Climate card

Opening the Climate tab immediately starts a refresh; the 60-second background
interval and 20-second startup delay remain. Single mode coalesces repeated taps
with any refresh already running. The six read-only requests remain sequential,
with 80 ms between rooms (400 ms total deliberate delay instead of 3 seconds).
New Sonos cover/favorite artwork downloads defer while this script runs; an
already-started download is not cancelled. The shared HTTP timeout remains 8 s.

The Climate tab replaces Extra with six read-only temperature readings in two columns. It uses dedicated temperature sensors, not radiator setpoints, air-quality sensors or wall-panel temperature readings. Both the sensor names and sensor device IDs are fully configurable via 6 generic slots in `.env` (with built-in defaults):

| Slot | Name variable (default) | Device ID variable | Default Homey sensor ID |
| --- | --- | --- | --- |
| Sensor 1 | `HOMEY_CLIMATE_SENSOR_1_NAME` (Woonkamer) | `HOMEY_CLIMATE_SENSOR_1_DEVICE_ID` | e5705cd4-ca02-4cdc-816f-4bc5fc4f5432 |
| Sensor 2 | `HOMEY_CLIMATE_SENSOR_2_NAME` (Aanbouw) | `HOMEY_CLIMATE_SENSOR_2_DEVICE_ID` | 564a9710-c503-4d04-9996-6c27b5f28157 |
| Sensor 3 | `HOMEY_CLIMATE_SENSOR_3_NAME` (Lieke) | `HOMEY_CLIMATE_SENSOR_3_DEVICE_ID` | 0d278a3e-aeb7-4cb3-bb2d-131766931482 |
| Sensor 4 | `HOMEY_CLIMATE_SENSOR_4_NAME` (Saar) | `HOMEY_CLIMATE_SENSOR_4_DEVICE_ID` | ed3cdd0e-2562-453a-a381-5c7d72bdf871 |
| Sensor 5 | `HOMEY_CLIMATE_SENSOR_5_NAME` (Werk Renate) | `HOMEY_CLIMATE_SENSOR_5_DEVICE_ID` | b4a69ec5-a37b-4617-b490-d4c7b74534b9 |
| Sensor 6 | `HOMEY_CLIMATE_SENSOR_6_NAME` (Werk Mark) | `HOMEY_CLIMATE_SENSOR_6_DEVICE_ID` | fae4c622-df59-4e18-8722-53fc9eb1cfb0 |

Polling uses six sequential GET requests separated by 80 ms. It never changes thermostats. Missing, unavailable, failed or implausible (-20 to 60 °C bounds) readings show `-- °C` rather than a stale value.

Heating status is explicitly unknown. The inspected Homey thermostats expose `target_temperature`, `measure_temperature` and `alarm_battery`, but no active-heating capability. A setpoint above measured temperature is not proof of actual heating. A confirmed per-room heating signal must be provided before active/inactive icons can be implemented.

The simulator and physical firmware both include this package; flashing remains a separate user-authorized step.
