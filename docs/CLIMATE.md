# Climate card

Opening the Climate tab immediately starts a refresh; the 60-second background
interval and 20-second startup delay remain. Single mode coalesces repeated taps
with any refresh already running. The six read-only requests remain sequential,
with 80 ms between rooms (400 ms total deliberate delay instead of 3 seconds).
New Sonos cover/favorite artwork downloads defer while this script runs; an
already-started download is not cancelled. The shared HTTP timeout remains 8 s.

The Climate tab replaces Extra with up to six read-only temperature readings. It uses dedicated temperature sensors, not radiator setpoints, air-quality sensors or wall-panel temperature readings. Both the sensor names and sensor device IDs are fully configurable via 6 generic slots in `.env`:

| Slot | Name variable (default) | Device ID variable | Default Homey sensor ID |
| --- | --- | --- | --- |
| Sensor 1 | `HOMEY_CLIMATE_SENSOR_1_NAME` (Woonkamer) | `HOMEY_CLIMATE_SENSOR_1_DEVICE_ID` | none |
| Sensor 2 | `HOMEY_CLIMATE_SENSOR_2_NAME` (Aanbouw) | `HOMEY_CLIMATE_SENSOR_2_DEVICE_ID` | none |
| Sensor 3 | `HOMEY_CLIMATE_SENSOR_3_NAME` (Lieke) | `HOMEY_CLIMATE_SENSOR_3_DEVICE_ID` | none |
| Sensor 4 | `HOMEY_CLIMATE_SENSOR_4_NAME` (Saar) | `HOMEY_CLIMATE_SENSOR_4_DEVICE_ID` | none |
| Sensor 5 | `HOMEY_CLIMATE_SENSOR_5_NAME` (Werk Renate) | `HOMEY_CLIMATE_SENSOR_5_DEVICE_ID` | none |
| Sensor 6 | `HOMEY_CLIMATE_SENSOR_6_NAME` (Werk Mark) | `HOMEY_CLIMATE_SENSOR_6_DEVICE_ID` | none |

Slots without a configured device ID in `.env` are automatically hidden and skipped during polling. The active sensors are dynamically positioned and centered (supporting 1, 2, 3, 4, 5, or 6 sensors). If no sensors are configured, a placeholder message is displayed.

Polling uses six sequential GET requests separated by 80 ms. It never changes thermostats. Missing, unavailable, failed or implausible (-20 to 60 °C bounds) readings show `-- °C` rather than a stale value.

Heating status is explicitly unknown. The inspected Homey thermostats expose `target_temperature`, `measure_temperature` and `alarm_battery`, but no active-heating capability. A setpoint above measured temperature is not proof of actual heating. A confirmed per-room heating signal must be provided before active/inactive icons can be implemented.

The simulator and physical firmware both include this package; flashing remains a separate user-authorized step.
