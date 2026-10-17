#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
esphome_bin="$project_dir/.venv/bin/esphome"
config_file="$project_dir/esphome/energydeck-crowpanel.yaml"
if [[ -f "$project_dir/.env" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      HOMEY_*|ENERGYDECK_*|SONOS_*)
        value="${value%$'\r'}"
        value="${value%\"}"
        value="${value#\"}"
        export "$key=$value"
        ;;
    esac
  done < "$project_dir/.env"
fi

serial_port="${1:-${ENERGYDECK_SERIAL_PORT:-/dev/cu.wchusbserial110}}"

export ENERGYDECK_ENERGY_TAX_EX_VAT_CT="${ENERGYDECK_ENERGY_TAX_EX_VAT_CT:-9.161}"
export ENERGYDECK_VAT_PERCENT="${ENERGYDECK_VAT_PERCENT:-21.0}"
export ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT="${ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT:-2.0}"
export SONOS_BOOTSTRAP_ADDRESS="${SONOS_BOOTSTRAP_ADDRESS:-http://192.168.1.50:1400}"
export SONOS_BOOTSTRAP_FALLBACK_ADDRESS="${SONOS_BOOTSTRAP_FALLBACK_ADDRESS:-http://192.168.1.51:1400}"

export HOMEY_CLIMATE_SENSOR_1_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_1_DEVICE_ID:-df2153b4-140f-58c7-8f74-61f07b306faf}"
export HOMEY_CLIMATE_SENSOR_2_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_2_DEVICE_ID:-81daa22c-c7f3-5dc9-ba68-9cb779bc50c0}"
export HOMEY_CLIMATE_SENSOR_3_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_3_DEVICE_ID:-fa4349b0-c27b-5fe5-bac5-478b49321440}"
export HOMEY_CLIMATE_SENSOR_4_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_4_DEVICE_ID:-ea7cff54-e985-5ce3-91a5-db3386ea3b53}"
export HOMEY_CLIMATE_SENSOR_5_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_5_DEVICE_ID:-34b71e13-7ccd-5697-bde0-1fbf5508d094}"
export HOMEY_CLIMATE_SENSOR_6_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_6_DEVICE_ID:-f7a5a06b-622b-5ede-8e78-f67474587632}"
export HOMEY_CLIMATE_SENSOR_1_NAME="${HOMEY_CLIMATE_SENSOR_1_NAME:-Woonkamer}"
export HOMEY_CLIMATE_SENSOR_2_NAME="${HOMEY_CLIMATE_SENSOR_2_NAME:-Aanbouw}"
export HOMEY_CLIMATE_SENSOR_3_NAME="${HOMEY_CLIMATE_SENSOR_3_NAME:-Bedroom 1}"
export HOMEY_CLIMATE_SENSOR_4_NAME="${HOMEY_CLIMATE_SENSOR_4_NAME:-Bedroom 2}"
export HOMEY_CLIMATE_SENSOR_5_NAME="${HOMEY_CLIMATE_SENSOR_5_NAME:-Office 1}"
export HOMEY_CLIMATE_SENSOR_6_NAME="${HOMEY_CLIMATE_SENSOR_6_NAME:-Office 2}"

for required in HOMEY_TOKEN ENERGYDECK_WIFI_SSID ENERGYDECK_WIFI_PASSWORD; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing $required in .env"
    exit 1
  fi
done

if [[ ! -x "$esphome_bin" ]]; then
  echo "ESPHome environment is missing. Run ./run.sh once first."
  exit 1
fi

if [[ ! -e "$serial_port" ]]; then
  echo "Serial port not found: $serial_port"
  exit 1
fi

echo "Building and uploading EnergyDeck through $serial_port"
cd "$project_dir"
exec "$esphome_bin" run "$config_file" --device "$serial_port"
