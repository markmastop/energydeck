#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
esphome_bin="$project_dir/.venv/bin/esphome"
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
config_file="${ENERGYDECK_CONFIG:-$project_dir/esphome/energydeck-crowpanel.yaml}"
if [[ "$serial_port" == "7" ]]; then
  serial_port="${ENERGYDECK_SERIAL_PORT:-/dev/cu.wchusbserial110}"
  config_file="$project_dir/esphome/energydeck-crowpanel-7.yaml"
elif [[ "${2:-}" == "7" || "${2:-}" =~ crowpanel-7 ]]; then
  config_file="$project_dir/esphome/energydeck-crowpanel-7.yaml"
elif [[ -n "${2:-}" && -f "${2:-}" ]]; then
  config_file="$2"
fi

export ENERGYDECK_ENERGY_TAX_EX_VAT_CT="${ENERGYDECK_ENERGY_TAX_EX_VAT_CT:-9.161}"
export ENERGYDECK_VAT_PERCENT="${ENERGYDECK_VAT_PERCENT:-21.0}"
export ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT="${ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT:-2.0}"
export SONOS_BOOTSTRAP_ADDRESS="${SONOS_BOOTSTRAP_ADDRESS:-http://192.168.0.190:1400}"
export SONOS_BOOTSTRAP_FALLBACK_ADDRESS="${SONOS_BOOTSTRAP_FALLBACK_ADDRESS:-http://192.168.0.191:1400}"

export HOMEY_CLIMATE_SENSOR_1_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_1_DEVICE_ID:-none}"
export HOMEY_CLIMATE_SENSOR_2_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_2_DEVICE_ID:-none}"
export HOMEY_CLIMATE_SENSOR_3_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_3_DEVICE_ID:-none}"
export HOMEY_CLIMATE_SENSOR_4_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_4_DEVICE_ID:-none}"
export HOMEY_CLIMATE_SENSOR_5_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_5_DEVICE_ID:-none}"
export HOMEY_CLIMATE_SENSOR_6_DEVICE_ID="${HOMEY_CLIMATE_SENSOR_6_DEVICE_ID:-none}"
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

echo "Building and uploading $(basename "$config_file" .yaml) through $serial_port"
cd "$project_dir"
exec "$esphome_bin" run "$config_file" --device "$serial_port"
