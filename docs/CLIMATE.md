# Climate card

The Climate tab replaces Extra with six read-only temperature readings in two columns. It uses the dedicated room sensors, not radiator setpoints, air-quality sensors or wall-panel temperature readings.

| Room | Homey sensor ID |
| --- | --- |
| Living room | df2153b4-140f-58c7-8f74-61f07b306faf |
| Extension | 81daa22c-c7f3-5dc9-ba68-9cb779bc50c0 |
| Bedroom 1 | fa4349b0-c27b-5fe5-bac5-478b49321440 |
| Bedroom 2 | ea7cff54-e985-5ce3-91a5-db3386ea3b53 |
| Office Renate | 34b71e13-7ccd-5697-bde0-1fbf5508d094 |
| Office Mark | f7a5a06b-622b-5ede-8e78-f67474587632 |

Polling runs every 60 seconds after a 20-second startup delay, with six sequential GET requests separated by 500 ms. It never changes thermostats. Missing, unavailable, failed or implausible (-20 to 60 °C bounds) readings show `-- °C` rather than a stale value.

Heating status is explicitly unknown. The inspected Homey thermostats expose `target_temperature`, `measure_temperature` and `alarm_battery`, but no active-heating capability. A setpoint above measured temperature is not proof of actual heating. A confirmed per-room heating signal must be provided before active/inactive icons can be implemented.

The simulator and physical firmware both include this package; flashing remains a separate user-authorized step.

