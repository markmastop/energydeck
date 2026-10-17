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
export SONOS_BOOTSTRAP_ADDRESS="${SONOS_BOOTSTRAP_ADDRESS:-http://192.168.0.190:1400}"
export SONOS_BOOTSTRAP_FALLBACK_ADDRESS="${SONOS_BOOTSTRAP_FALLBACK_ADDRESS:-http://192.168.0.191:1400}"

export HOMEY_CLIMATE_SENSOR_1_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_1_DEVICE_ID:-e5705cd4-ca02-4cdc-816f-4bc5fc4f5432}"
export HOMEY_CLIMATE_SENSOR_2_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_2_DEVICE_ID:-564a9710-c503-4d04-9996-6c27b5f28157}"
export HOMEY_CLIMATE_SENSOR_3_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_3_DEVICE_ID:-0d278a3e-aeb7-4cb3-bb2d-131766931482}"
export HOMEY_CLIMATE_SENSOR_4_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_4_DEVICE_ID:-ed3cdd0e-2562-453a-a381-5c7d72bdf871}"
export HOMEY_CLIMATE_SENSOR_5_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_5_DEVICE_ID:-b4a69ec5-a37b-4617-b490-d4c7b74534b9}"
export HOMEY_CLIMATE_SENSOR_6_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_6_DEVICE_ID:-fae4c622-df59-4e18-8722-53fc9eb1cfb0}"
export HOMEY_CLIMATE_SENSOR_1_NAME="${HOMEY_CLIMATE_SENSOR_1_NAME:-Woonkamer}"
export HOMEY_CLIMATE_SENSOR_2_NAME="${HOMEY_CLIMATE_SENSOR_2_NAME:-Aanbouw}"
export HOMEY_CLIMATE_SENSOR_3_NAME="${HOMEY_CLIMATE_SENSOR_3_NAME:-Lieke}"
export HOMEY_CLIMATE_SENSOR_4_NAME="${HOMEY_CLIMATE_SENSOR_4_NAME:-Saar}"
export HOMEY_CLIMATE_SENSOR_5_NAME="${HOMEY_CLIMATE_SENSOR_5_NAME:-Werk Renate}"
export HOMEY_CLIMATE_SENSOR_6_NAME="${HOMEY_CLIMATE_SENSOR_6_NAME:-Werk Mark}"

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
