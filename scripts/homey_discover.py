#!/usr/bin/env python3
"""Check Homey Pro and list useful EnergyDeck data sources."""

from __future__ import annotations

import getpass
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parents[1]


def load_env() -> None:
    env_file = PROJECT_DIR / ".env"
    if not env_file.exists():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def ask_connection() -> tuple[str, str]:
    print("EnergyDeck - Homey connection check\n")
    load_env()
    saved_address = os.environ.get("HOMEY_ADDRESS", "").strip()
    saved_token = os.environ.get("HOMEY_TOKEN", "").strip()
    address_prompt = "Local Homey address"
    if saved_address:
        address_prompt += f" [{saved_address}]"
    address = input(f"{address_prompt}: ").strip() or saved_address
    if not address:
        raise ValueError("No Homey address was provided.")
    token = saved_token or getpass.getpass(
        "Homey API Key (not stored): "
    ).strip()
    if not token:
        raise ValueError("No access token was provided.")
    return address.rstrip("/"), token


class HomeyClient:
    def __init__(self, address: str, token: str) -> None:
        self.address = address
        self.token = token
        self.ssl_context = ssl.create_default_context()

    def get(self, path: str, query: dict[str, str] | None = None):
        url = f"{self.address}{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                "User-Agent": "EnergyDeck-setup/0.1",
            },
        )
        with urllib.request.urlopen(request, timeout=8, context=self.ssl_context) as response:
            return json.loads(response.read().decode("utf-8"))


def values(payload):
    if isinstance(payload, dict):
        return payload.values()
    if isinstance(payload, list):
        return payload
    return []


def print_prices(client: HomeyClient) -> None:
    try:
        payload = client.get(
            "/api/manager/energy/price/electricity/dynamic",
            {"date": date.today().isoformat()},
        )
    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 404):
            print(
                "\nNative Energy prices are not available to this API Key. "
                "EnergyDeck will use the HomeyScript Logic-variable bridge."
            )
            return
        raise
    if isinstance(payload, list):
        count = len(payload)
    elif isinstance(payload, dict):
        candidates = [v for v in payload.values() if isinstance(v, list)]
        count = max((len(v) for v in candidates), default=len(payload))
    else:
        count = 0
    print(f"\nDynamic prices found: {count} values")


def print_logic_variables(client: HomeyClient) -> None:
    try:
        payload = client.get("/api/manager/logic/variable")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403, 404):
            print("\nLogic variables are unavailable; add Logic / Variables read access.")
            return
        raise
    matches = []
    for variable in values(payload):
        if not isinstance(variable, dict):
            continue
        if "energydeck" in str(variable.get("name", "")).lower():
            matches.append(variable)
    print("\nEnergyDeck Logic variables:")
    if not matches:
        print("  None found yet. Install and run the EnergyDeck HomeyScript bridge.")
        return
    for variable in matches:
        print(f"- {variable.get('name', 'Unnamed variable')}")
        print(f"  variable id: {variable.get('id', '?')}")
        raw_value = variable.get("value")
        if isinstance(raw_value, str):
            try:
                bridge_data = json.loads(raw_value)
            except json.JSONDecodeError:
                print(f"  value: {len(raw_value)} bytes, not valid JSON")
                continue
            prices = bridge_data.get("prices") if isinstance(bridge_data, dict) else None
            if isinstance(prices, list):
                price_count = len(prices)
            elif isinstance(prices, dict):
                candidates = [item for item in prices.values() if isinstance(item, list)]
                price_count = max((len(item) for item in candidates), default=len(prices))
            else:
                price_count = 0
            print(f"  date: {bridge_data.get('date', '?')}")
            print(f"  price values: {price_count}")
            print(f"  payload size: {len(raw_value)} bytes")
            if isinstance(prices, list) and prices:
                sample = prices[0]
                if isinstance(sample, dict):
                    print(f"  price fields: {', '.join(sorted(sample.keys()))}")
                    safe_sample = {
                        key: sample[key]
                        for key in sample
                        if key.lower() in {"time", "date", "start", "end", "price", "value"}
                    }
                    if safe_sample:
                        print(f"  first price: {json.dumps(safe_sample, separators=(',', ':'))}")
                else:
                    print(f"  first prices: {json.dumps(prices[:4], separators=(',', ':'))}")
            elif isinstance(prices, dict):
                print(f"  price container fields: {', '.join(sorted(prices.keys()))}")
                for key, items in prices.items():
                    if isinstance(items, list) and items:
                        print(
                            f"  list {key}: {len(items)} items, first "
                            f"{json.dumps(items[:2], separators=(',', ':'))}"
                        )


def print_devices(client: HomeyClient) -> None:
    payload = client.get("/api/manager/devices/device")
    interesting = {
        "measure_power",
        "meter_power",
        "measure_battery",
        "meter_gas",
        "measure_current",
        "measure_voltage",
        "charging_state",
        "is_connected",
        "is_charging",
    }
    print("\nPossible energy devices:")
    found = 0
    selected_ids = {
        value
        for value in (
            os.environ.get("HOMEY_SESSY_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_CHARGER_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_HOMEWIZARD_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_ELECTRICITY_SUMMARY_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_GAS_SUMMARY_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_SOLAR_DEVICE_ID", "").strip(),
            os.environ.get("HOMEY_SOLAR_SUMMARY_DEVICE_ID", "").strip(),
        )
        if value
    }
    live_capabilities = {
        "measure_battery",
        "measure_power",
        "measure_power.battery",
        "meter_power",
        "measure_gas",
        "meter_gas",
        "charge_mode",
        "system_state",
        "is_connected",
        "is_charging",
        "is_allowed",
        "status",
        "alarm_device",
        "meter_kwh_this_day",
        "meter_kwh_this_year",
        "measure_watt_max",
        "measure_watt_avg",
        "meter_m3_this_day",
        "meter_m3_this_month",
        "meter_m3_this_year",
    }
    for device in values(payload):
        if not isinstance(device, dict):
            continue
        capabilities = set(device.get("capabilities") or [])
        name = str(device.get("name", "Unnamed device"))
        driver = str(device.get("driverId", ""))
        searchable = f"{name} {driver}".lower()
        if capabilities.intersection(interesting) or any(
            word in searchable for word in ("sessy", "homewizard", "p1", "gas", "energy")
        ):
            found += 1
            print(f"\n- {name}")
            print(f"  device id: {device.get('id', '?')}")
            print(f"  capabilities: {', '.join(sorted(capabilities)) or '-'}")
            is_daily_summary = {
                "meter_kwh_this_day",
                "measure_watt_max",
            }.issubset(capabilities)
            is_gas_summary = {
                "meter_m3_this_day",
                "meter_m3_this_month",
                "meter_m3_this_year",
            }.issubset(capabilities)
            if device.get("id") in selected_ids or is_daily_summary or is_gas_summary:
                capabilities_obj = device.get("capabilitiesObj") or {}
                print("  selected source values:")
                for capability_id in sorted(capabilities.intersection(live_capabilities)):
                    capability = capabilities_obj.get(capability_id) or {}
                    value = capability.get("value", "-")
                    units = capability.get("units") or ""
                    suffix = f" {units}" if units else ""
                    print(f"    {capability_id}: {value}{suffix}")
    if not found:
        print("  No likely candidates found; check the token permissions.")


def print_flows(client: HomeyClient) -> None:
    print("\nFlows containing 'auto', 'laad' or 'charge' in their name:")
    found = 0
    endpoints = (
        ("Flow", "/api/manager/flow/flow"),
        ("Advanced Flow", "/api/manager/flow/advancedflow"),
    )
    for kind, endpoint in endpoints:
        try:
            payload = client.get(endpoint)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403, 404):
                continue
            raise
        for flow in values(payload):
            if not isinstance(flow, dict):
                continue
            name = str(flow.get("name", "Unnamed Flow"))
            if any(word in name.lower() for word in ("auto", "laad", "charge")):
                found += 1
                print(f"- {name} ({kind})")
                print(f"  Flow id: {flow.get('id', '?')}")
    if not found:
        print("  No matching Flow name found.")


def main() -> int:
    try:
        address, token = ask_connection()
        client = HomeyClient(address, token)
        print_devices(client)
        print("\nSuccessfully connected to Homey.")
        print_prices(client)
        print_logic_variables(client)
        print_flows(client)
        if os.environ.get("HOMEY_TOKEN"):
            print("\nDone. The token was read only from your local .env file.")
        else:
            print("\nDone. The token was not stored.")
        return 0
    except ValueError as error:
        print(f"\n{error}", file=sys.stderr)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            print("\nHomey rejected the token or a required permission is missing.", file=sys.stderr)
        else:
            print(f"\nHomey returned HTTP error {error.code}.", file=sys.stderr)
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"\nHomey is unreachable: {error}", file=sys.stderr)
    except json.JSONDecodeError:
        print("\nHomey returned a response that EnergyDeck does not recognize yet.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
