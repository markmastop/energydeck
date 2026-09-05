#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
esphome_bin="$project_dir/.venv/bin/esphome"
config_file="$project_dir/esphome/energydeck-crowpanel.yaml"
serial_port="${1:-/dev/cu.wchusbserial110}"

if [[ -f "$project_dir/.env" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      HOMEY_*|ENERGYDECK_*)
        value="${value%$'\r'}"
        value="${value%\"}"
        value="${value#\"}"
        export "$key=$value"
        ;;
    esac
  done < "$project_dir/.env"
fi

export ENERGYDECK_ENERGY_TAX_EX_VAT_CT="${ENERGYDECK_ENERGY_TAX_EX_VAT_CT:-9.161}"
export ENERGYDECK_VAT_PERCENT="${ENERGYDECK_VAT_PERCENT:-21.0}"
export ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT="${ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT:-2.0}"

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
