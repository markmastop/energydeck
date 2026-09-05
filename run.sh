#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
venv_dir="$project_dir/.venv"
esphome_bin="$venv_dir/bin/esphome"
config_file="$project_dir/esphome/energydeck-simulator.yaml"

# Dutch/Zonneplan 2026 defaults. Override these values in .env when needed.
export ENERGYDECK_ENERGY_TAX_EX_VAT_CT="${ENERGYDECK_ENERGY_TAX_EX_VAT_CT:-9.161}"
export ENERGYDECK_VAT_PERCENT="${ENERGYDECK_VAT_PERCENT:-21.0}"
export ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT="${ENERGYDECK_SUPPLIER_FEE_INCL_VAT_CT:-2.0}"

if [[ -f "$project_dir/.env" ]]; then
  while IFS='=' read -r key value; do
    case "$key" in
      HOMEY_*|ENERGYDECK_*)
        value="${value%\"}"
        value="${value#\"}"
        export "$key=$value"
        ;;
    esac
  done < "$project_dir/.env"
fi

if ! command -v sdl2-config >/dev/null 2>&1; then
  echo "SDL2 is missing. Install the simulator libraries first:"
  echo "  brew install sdl2 libsodium"
  exit 1
fi

if [[ ! -x "$esphome_bin" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is missing. Install Python 3 and try again."
    exit 1
  fi

  echo "Installing ESPHome locally for EnergyDeck..."
  python3 -m venv "$venv_dir"
  "$venv_dir/bin/pip" install esphome
fi

echo "Starting the EnergyDeck simulator. Press Ctrl+C to stop."
cd "$project_dir"
exec "$esphome_bin" run "$config_file"
