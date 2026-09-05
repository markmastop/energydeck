# Homey integration

EnergyDeck will use the local Homey Pro Web API. Energy data therefore stays
inside the home network and no separate cloud server is required.

## Integration scope

- 96 dynamic electricity prices per day;
- current electricity consumption and historical energy reports;
- Sessy state of charge, charging direction and power;
- go-eCharger vehicle connection and charging status;
- HomeWizard gas readings;
- starting the existing EV charging Flow.

## One-time connection check

EnergyDeck requires a local **Homey API Key**. Homey's API uses this key as a
Personal Access Token in the HTTP `Authorization: Bearer` header. Do not create
an OAuth Client ID, Client Secret or app-specific key. See Homey's official
[Create and use API Keys on Homey Pro](https://support.homey.app/hc/en-us/articles/8178797067292-Create-and-use-API-Keys-on-Homey-Pro)
guide for the original instructions.

1. Open [Homey Web App](https://my.homey.app/), select the correct Homey Pro,
   then go to **Settings → API Keys → New API Key**.
2. Name the key `EnergyDeck` and select these permissions:
   - **Devices — Read only** (`homey.device.readonly`)
   - **Flows — Read only** (`homey.flow.readonly`)
   - **Flows — Start** (`homey.flow.start`)
   - **Logic / Variables — Read only** (`homey.logic.readonly`)
   - **Location — Read only** (`homey.geolocation.readonly`)

   When Homey is set to Dutch, select these five indented rows:
   - **Apparaten weergeven** (`homey.device.readonly`)
   - **Flows weergeven** (`homey.flow.readonly`)
   - **Flows starten** (`homey.flow.start`)
   - **Variabelen weergeven** (`homey.logic.readonly`)
   - **Locatie weergeven** (`homey.geolocation.readonly`)

   Leave the blue parent rows **Apparaten**, **Flows** and **Variabelen**
   unchecked. Selecting a parent row enables the whole permission group. For
   example, the **Apparaten** parent also enables **Apparaten besturen**, which
   EnergyDeck does not require.
3. Click **Create** and copy the key immediately. It is only displayed once.
   Use this API Key as `HOMEY_TOKEN`; do not create an OAuth Client ID or
   Client Secret.
4. Find the local IP address of Homey Pro.
5. Run from the EnergyDeck directory:

   ```sh
   ./homey-setup.sh
   ```

6. Enter the local address and token. These can also be added to the local
   `.env` file beforehand.

Keep the API Key private. Homey only displays it once after creation, but it
can be revoked at any time under **Settings → API Keys**. If it is ever shared
accidentally, revoke it and create a replacement immediately.

### Why Energy is not in the permission list

Homey's Web API documents an `homey.energy.readonly` scope, but Homey currently
does not expose an Energy checkbox when creating an API Key. Do not select the
top-level full Homey permission just to work around this.

EnergyDeck uses a least-privilege bridge instead: a HomeyScript reads Homey's
internal quarter-hour prices and writes them to an `EnergyDeck Prices` Logic
variable. The EnergyDeck API Key only needs read access to Logic / Variables.
The bridge source is available in `homeyscript/energydeck-prices.js`.

To install the bridge:

1. Install the official HomeyScript app if it is not installed yet.
2. Open [HomeyScript](https://my.homey.app/script) in a browser.
3. Create a new script named `EnergyDeck Prices`.
4. Copy the contents of `homeyscript/energydeck-prices.js` into it.
5. Save and run it once. The returned result should report 96 intervals for
   today. Tomorrow also reports 96 once Homey has published the next day's
   prices; before publication it can be empty.
6. Run `./homey-setup.sh` again. It will show the created Logic variable ID.

Later, an Advanced Flow can run this HomeyScript after new prices become
available. EnergyDeck only reads the resulting Logic variable. Version 2 of
the bridge stores compact arrays for both today and tomorrow. The simulator
loads them at startup and refreshes the variable every five minutes.

The check lists relevant device IDs, capabilities and the charging Flow ID.
This information is used to enable the final ESPHome integration.

### Sessy live data

EnergyDeck reads the Sessy device through Homey's local Devices API every 15
seconds. It uses `measure_battery` for state of charge and
`measure_power.battery`, with `measure_power` as a fallback, for live power.
Negative battery power is displayed as charging, positive battery power as
discharging, and a
value between -25 W and +25 W as standby. This integration is read-only.

### EV charger status

EnergyDeck reads the go-eCharger every 15 seconds. It uses `is_connected`,
`is_charging`, `status`, `alarm_device` and `measure_power` to distinguish
between disconnected, ready, charging, completed and fault states. With no
vehicle connected, the card says `EV - not connected` and the charging button
is grey and disabled. A completed session is shown separately so it is not
mistaken for a vehicle waiting to charge.

### Live electricity use

EnergyDeck reads current net power from the HomeWizard P1 device every 10
seconds. Every five minutes, the Homey summary device supplies today's imported
energy and maximum power. These are shown as two compact rings: kWh used today
and current kW, with the year's electricity use and the day's kW peak
underneath. A negative current value indicates net export.

### Live solar production

EnergyDeck reads current production from the inverter device every 15 seconds.
The Homey solar summary supplies today's generated energy every five minutes.
They share one green ring: current kW inside the ring and today's kWh directly
underneath it.

### Gas usage

EnergyDeck reads Homey's gas summary every five minutes. It displays today's,
this month's and this year's measured use. Homey's summary device does not
provide a direct `this week` capability, so EnergyDeck deliberately uses the
three exact periods instead of estimating a weekly total.

## Local settings

The `.env` file contains:

- `HOMEY_ADDRESS`: the local Homey Pro address;
- `HOMEY_TOKEN`: the Personal Access Token;
- `HOMEY_CHARGE_FLOW_ID`: the forced EV charging Flow;
- `HOMEY_CHARGER_DEVICE_ID`: the go-eCharger device used for live EV status;
- `HOMEY_SESSY_DEVICE_ID`: the Sessy device;
- `HOMEY_HOMEWIZARD_DEVICE_ID`: the HomeWizard device.
- `HOMEY_ELECTRICITY_SUMMARY_DEVICE_ID`: the Homey summary device containing
  `meter_kwh_this_day` and `measure_watt_max`;
- `HOMEY_GAS_SUMMARY_DEVICE_ID`: the Homey gas summary containing daily,
  monthly and yearly gas totals;
- `HOMEY_SOLAR_DEVICE_ID`: the inverter device containing live
  `measure_power`;
- `HOMEY_SOLAR_SUMMARY_DEVICE_ID`: the solar summary containing
  `meter_kwh_this_day`;
- `HOMEY_PRICES_VARIABLE_ID`: the `EnergyDeck Prices` Logic variable.
- `ENERGYDECK_ENERGY_TAX_EX_VAT_CT`: energy tax in ct/kWh before VAT;
- `ENERGYDECK_VAT_PERCENT`: VAT percentage applied to market price and tax;
- `ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT`: supplier fee in ct/kWh including VAT.
- `ENERGYDECK_LATITUDE` and `ENERGYDECK_LONGITUDE`: Homey's location, used
  locally to calculate sunrise and sunset without an internet service.

An empty example is available in `.env.example`. Git ignores the real `.env`.

## All-in electricity prices

EnergyDeck converts Homey's dynamic market price to a household purchase price
with this formula:

```text
(market price + energy tax) * VAT + supplier purchasing fee
```

`run.sh` uses these 2026 Netherlands/Zonneplan defaults:

```env
ENERGYDECK_ENERGY_TAX_EX_VAT_CT=9.161
ENERGYDECK_VAT_PERCENT=21.0
ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT=2.0
```

For example, a Homey market price of 16.1 ct/kWh becomes approximately 32.6
ct/kWh all-in. Fixed monthly supplier charges, grid operator charges and the
annual energy-tax reduction are not quarter-hour costs and are therefore not
included in the chart. Update the environment values when the tax rate or
contract changes.

## Device secrets

When the physical ESP32 is configured, the required values are copied from
`.env` to `esphome/secrets.yaml`. Git also ignores that file, and it must never
be pushed to GitHub.
