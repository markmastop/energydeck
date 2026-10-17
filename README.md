# EnergyDeck

<p align="center">
  <img src="docs/energydeck-dashboard.svg" width="250" alt="EnergyDeck Dashboard" />
  &nbsp;
  <img src="docs/energydeck-sonos.svg" width="250" alt="EnergyDeck Sonos Player" />
  &nbsp;
  <img src="docs/energydeck-climate.svg" width="250" alt="EnergyDeck Climate Sensors" />
</p>

EnergyDeck is an open-source, local energy and smart home dashboard built with [ESPHome](https://esphome.io/) and [LVGL](https://lvgl.io/) for the **ELECROW CrowPanel Advance 5.0" and 7.0"** ESP32-S3 HMI touch displays and **Homey Pro**.

It connects directly over your local network to Homey and Sonos to provide a real-time, responsive household overview in a clean portrait interface.

---

## Features

- ⚡ **Dynamic Electricity Prices:** 96 quarter-hour price bars for today and tomorrow, daily minimum and maximum, and automatic identification of the cheapest consecutive 3-hour window. Calculates all-in household electricity prices (energy tax, VAT, and supplier fee).
- ☀️ **Solar & Net Power:** Live solar generation, net grid import/export power with direction indicators, and daily solar peak and total yield.
- 🔋 **Home Battery (Sessy):** Live state of charge (SoC %), charge/discharge power, and operational status.
- 🚗 **EV Smart Charging:** Real-time go-eCharger connection and charging status, with one-touch button to trigger your Homey smart charging Flow.
- 🎵 **Direct Local Sonos Player:** Zero-cloud UPnP control on port 1400 directly to Sonos speakers. Features both a compact dashboard card and a full-screen player page with embedded high-resolution station artwork (e.g. Joe, Qmusic, Sky Radio, Radio 538, NPO Radio 2), volume controls, household room grouping, and a 4-row favorites grid.
- 🌡️ **Multi-room Climate:** Up to 6 room temperature sensor cards with color-coded comfort badges.
- 🌧️ **Local Weather & Rain Radar:** 2-hour Buienradar precipitation graph and 3-hour Open-Meteo temperature outlook.
- 🌙 **Automatic Night Dimming:** Time-based backlight dimming (e.g. 23:00 to 07:00) with instant touch-to-wake.
- 💻 **Desktop Simulator:** Test and preview the exact UI on macOS or Linux with live data before touching hardware.

---

## Supported Hardware

| Model | Screen Size | Resolution | Part Number | Flash Target |
| :--- | :--- | :--- | :--- | :--- |
| **CrowPanel Advance 5.0"** | 5.0 inch IPS | 800 x 480 | `DIS02050A001` | `./flash.sh` |
| **CrowPanel Advance 7.0"** | 7.0 inch IPS | 800 x 480 | `DIS02170A` | `./flash.sh 7` |

Both hardware models share the same ESP32-S3 processor, 8 MB PSRAM, 16 MB flash, GT911 capacitive touch controller, and I²C backlight protocol.

---

## Quick Start & Installation

### Step 1: Prerequisites

Make sure you have **Python 3.10+** and **Git** installed on your computer.

On macOS (required only if you want to run the local desktop simulator):
```sh
brew install sdl2 libsodium
```

### Step 2: Clone & Configure Environment

Clone the repository and copy the example environment configuration:

```sh
git clone https://github.com/markm/energydeck.git
cd energydeck
cp .env.example .env
```

Open `.env` in your text editor and fill in your Wi-Fi credentials:

```dotenv
ENERGYDECK_WIFI_SSID=your-wifi-name
ENERGYDECK_WIFI_PASSWORD=your-wifi-password
```

### Step 3: Connect Homey & Auto-Discover Devices

1. Open [Homey Web App](https://my.homey.app/) and sign in.
2. Go to **Settings → API Keys** and click **New API Key**.
3. Name it `EnergyDeck` and select only these read-only permissions:
   - **Devices — Read only** (`homey.device.readonly` / *Apparaten weergeven*)
   - **Flows — Read only** (`homey.flow.readonly` / *Flows weergeven*)
   - **Flows — Start** (`homey.flow.start` / *Flows starten*)
   - **Logic / Variables — Read only** (`homey.logic.readonly` / *Variabelen weergeven*)
   - **Location — Read only** (`homey.geolocation.readonly` / *Locatie weergeven*)
4. Copy the API key and add your Homey IP and key to `.env`:
   ```dotenv
   HOMEY_ADDRESS=http://192.168.1.100
   HOMEY_TOKEN=your-homey-api-key
   ```
5. Run the interactive discovery tool:
   ```sh
   ./homey-setup.sh
   ```
   This wizard scans your Homey for Sessy batteries, HomeWizard P1 meters, solar inverters, EV chargers, and climate sensors, and outputs the exact device IDs to add to your `.env`.

6. **Sync dynamic energy prices:** In the Homey Web App, go to **HomeyScript**, create a new script named `EnergyDeck Prices`, and paste the contents of [`homeyscript/energydeck-prices.js`](homeyscript/energydeck-prices.js). Create a Flow that runs this script every hour or when electricity prices update.

### Step 4: Configure Sonos (Optional)

EnergyDeck connects directly to your Sonos speakers via local HTTP/UPnP on port 1400. You only need to specify one speaker address (bootstrap seed); EnergyDeck automatically queries it to discover the entire household zone topology and all other rooms.

In `.env`:
```dotenv
SONOS_BOOTSTRAP_ADDRESS=http://192.168.1.50:1400
SONOS_BOOTSTRAP_FALLBACK_ADDRESS=http://192.168.1.51:1400
```

*(Tip: Set a static DHCP reservation in your router for your bootstrap speaker).*

### Step 5: Preview in Simulator (Optional)

Test your configuration on your computer before flashing:

```sh
./run.sh
```

The script automatically prepares a local Python virtual environment, installs ESPHome, and launches the live interactive LVGL simulator. Stop it with `Ctrl+C`.

---

## Flashing Your CrowPanel Display

### 1. Connect over USB

Connect your CrowPanel display to your computer using a USB-C data cable (note: charge-only cables will power the screen but cannot transfer data).

**macOS Serial Driver (CH34x):**
The CrowPanel uses a WCH CH34x USB-to-serial chip. If `/dev/cu.wchusbserial...` does not appear in `ls /dev/cu.*`, download and install the official [WCH CH34x driver for macOS](https://www.wch.cn/downloads/CH34XSER_MAC_ZIP.html).
After installation, open **System Settings → General → Login Items & Extensions → Driver Extensions** and enable **CH34xVCPDriver / WCH**.

### 2. Enter Download Mode

To put the display in flashing mode:
1. Hold down the **BOOT** button on the back of the CrowPanel.
2. Press and release the **RST** button while continuing to hold **BOOT**.
3. Release the **BOOT** button after 1 second.

### 3. Back Up Factory Firmware (Recommended)

Before flashing for the first time, create a full 16 MB flash backup of your factory firmware:

```sh
./.venv/bin/python scripts/backup_factory_flash.py \
  --port /dev/cu.wchusbserial110 \
  --baud 115200 \
  --output backups/crowpanel-factory-backup.bin
```

*(Replace `/dev/cu.wchusbserial110` with your port if different).*

### 4. Flash EnergyDeck

Run the flash script matching your display size:

#### 🔹 For the 5-inch Display:
```sh
./flash.sh
```
*(Optionally specify a custom serial port: `./flash.sh /dev/cu.wchusbserial110`)*

#### 🔹 For the 7-inch Display:
```sh
./flash.sh 7
```
*(Optionally specify a custom serial port: `./flash.sh /dev/cu.wchusbserial110 7`)*

The script reads `.env`, builds the firmware with ESPHome, uploads it via `esptool`, and displays the live boot logs.

---

## Over-The-Air (OTA) Updates

Once flashed, the display can be updated wirelessly over Wi-Fi without connecting a USB cable:

- **5-inch display:** `.venv/bin/esphome run esphome/energydeck-crowpanel.yaml --device energydeck.local`
- **7-inch display:** `.venv/bin/esphome run esphome/energydeck-crowpanel-7.yaml --device energydeck-7.local`

---

## Display Navigation & Controls

| Gesture / Tap Target | Action |
| :--- | :--- |
| **Tap Price Graph Header** | Switch between *Today* and *Tomorrow* price forecasts |
| **Tap Energy / Solar Ring** | Toggle between daily energy use and year-to-date totals |
| **Tap Bottom Card Tabs** | Switch between *Gasverbruik* (Gas), *Sonos*, and *Klimaat* (Climate) |
| **Tap Compact Sonos Card** | Open full-screen Sonos player with artwork and favorite stations |
| **Sonos Player Back Button** | Return to the main dashboard |
| **Touch Display during Night** | Wake screen to full daytime brightness for 30 seconds |

---

## Automatic Night Dimming

EnergyDeck includes hardware-level backlight dimming to avoid lighting up a dark room at night:

```dotenv
# Backlight brightness (0 is maximum brightness, 245 is minimum/dimmed)
ENERGYDECK_BACKLIGHT_DAY_BRIGHTNESS=48
ENERGYDECK_BACKLIGHT_NIGHT_BRIGHTNESS=160

# Night schedule (24-hour format)
ENERGYDECK_BACKLIGHT_NIGHT_START_HOUR=23
ENERGYDECK_BACKLIGHT_NIGHT_END_HOUR=7

# Wake duration in seconds when touched at night
ENERGYDECK_BACKLIGHT_WAKE_DURATION_S=30
```

---

## Documentation Links

- [Sonos Integration Architecture](docs/SONOS.md) — UPnP/SOAP protocol details, queue guards, embedded station artwork, and zero-cloud direct control.
- [Homey Pro Integration](docs/HOMEY.md) — Local Web API token, rate limits, device schemas, and price bridging.
- [Multi-room Climate Setup](docs/CLIMATE.md) — Configuring up to 6 room temperature sensors with Homey.
- [Rain Radar & Weather](docs/RAIN.md) — Buienradar 2-hour rain forecast and Open-Meteo temperature integration.
- [Performance & Memory Architecture](docs/PERFORMANCE.md) — PSRAM heap routing, LVGL partial rendering, and benchmark diagnostics.
- [Development & Contribution Guidelines](AGENTS.md) — Working agreements, code style, and Git commit policies.

---

## License

This project is open-source under the MIT License.
