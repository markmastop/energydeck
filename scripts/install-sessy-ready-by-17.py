#!/usr/bin/env python3
"""Preview/install the reserve step in the existing Sessy - Run Flow.

Reads .env without executing it. Default is read-only; --apply enables the
controller. Flow backups are private local files in ignored build/.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import sys
import urllib.request
from datetime import datetime, timezone

sys.dont_write_bytecode = True
from homey_discover import HomeyClient, load_env, values

ROOT = Path(__file__).resolve().parents[1]
ENABLED = "sessy_ready_by_17_enabled"
STATE = "sessy_ready_by_17_state"
PLAN = "sessy_ready_by_17_plan"
ERROR_NODE = "21d27afb-a34c-45f4-baa6-1b3aa6eefce7"
MARKER = "const DEVICE_ID = '__SESSY_DEVICE_ID__';"


def patch_flow(flow, source, device_id):
    """Replace only normal target calculation; retain actuator/guard branches."""
    original = copy.deepcopy(flow)
    candidates = [(key, card) for key, card in flow["cards"].items()
                  if card.get("args", {}).get("variable", {}).get("name") == "sessy_doel_vermogen"
                  and card.get("id") == "homey:manager:logic:variable_set_number_math"]
    installed = [(key, card) for key, card in flow["cards"].items()
                 if card.get("id") == "homey:app:com.athom.homeyscript:runCode_v2"
                 and "sessy_ready_by_17_enabled" in card.get("args", {}).get("code", "")]
    if len(candidates) + len(installed) != 1:
        raise ValueError("Expected exactly one original/installed normal-control calculation")
    if MARKER not in source:
        raise ValueError("Missing device binding marker")
    code = source.replace(MARKER, "const DEVICE_ID = " + json.dumps(device_id) + ";")
    key, card = (candidates or installed)[0]
    success = card.get("outputSuccess", [])
    if len(success) != 1:
        raise ValueError("Unexpected normal-control continuation")
    if candidates:
        expression = card.get("args", {}).get("value", "")
        if "*2/3" not in expression or "/3" not in expression:
            raise ValueError("Normal smoothing changed; review before installing")
        # Bind only to the device already used by the Flow's actuators.
        owners = {c.get("ownerUri") for c in flow["cards"].values()
                  if c.get("id", "").endswith(":set_power_setpoint")}
        if owners != {"homey:device:" + device_id}:
            raise ValueError("Configured Sessy does not match the Flow actuators")
        if ERROR_NODE in flow["cards"]:
            raise ValueError("Fallback card ID already in use")
    flow["cards"][key] = {
        "ownerUri": "homey:app:com.athom.homeyscript",
        "id": "homey:app:com.athom.homeyscript:runCode_v2",
        "args": {"code": code}, "type": "action", "x": card["x"], "y": card["y"],
        "outputSuccess": success, "outputError": [ERROR_NODE],
    }
    if candidates:
        flow["cards"][ERROR_NODE] = {
            "ownerUri": "homey:manager:logic", "id": "homey:manager:logic:variable_set_number",
            "args": {"variable": card["args"]["variable"], "value": 0},
            "type": "action", "x": card["x"], "y": card["y"] + 120,
            "outputSuccess": success,
        }
    # All existing triggers, manual controls, price/EV/SoC guards and device
    # commands must remain byte-for-byte equivalent as parsed JSON.
    for other, value in original["cards"].items():
        if other not in {key, ERROR_NODE} and flow["cards"][other] != value:
            raise ValueError("Unexpected change outside the normal calculation")
    return flow, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Install and enable (changes real charging behavior)")
    parser.add_argument("--configure-readers", action="store_true", help="Save only the plan variable ID in local .env")
    parser.add_argument("--restore", type=Path, help="Restore an exact Flow backup; requires --apply")
    args = parser.parse_args()
    load_env()
    client = HomeyClient(os.environ["HOMEY_ADDRESS"].rstrip("/"), os.environ["HOMEY_TOKEN"])

    def write(method, path, body):
        request = urllib.request.Request(client.address + path, method=method,
            data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + client.token,
                "Content-Type": "application/json", "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=20, context=client.ssl_context) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    def flow_body(flow):
        return {key: flow[key] for key in ("name", "folder", "enabled", "cards") if key in flow}

    variables = list(values(client.get("/api/manager/logic/variable")))
    def lookup(name, kind):
        found = [v for v in variables if v.get("name") == name]
        if len(found) > 1 or (found and found[0]["type"] != kind):
            raise ValueError("Unexpected Logic variable type/count: " + name)
        return found[0] if found else None

    if args.restore:
        if not args.apply:
            raise ValueError("Restoration requires --apply")
        flow = json.loads(args.restore.read_text())
        flag = lookup(ENABLED, "boolean")
        if flag:
            write("PUT", "/api/manager/logic/variable/" + flag["id"], {"value": False})
        path = "/api/manager/flow/advancedflow/" + flow["id"]
        write("PUT", path, flow_body(flow))
        actual = client.get(path)
        if flow_body(actual) != flow_body(flow):
            raise RuntimeError("Restore read-back differs from the backup")
        print("Restored and verified:", flow["name"])
        return

    flows = [f for f in values(client.get("/api/manager/flow/advancedflow")) if f.get("name") == "Sessy - Run"]
    if len(flows) != 1 or not flows[0].get("enabled"):
        raise ValueError("Expected one enabled Sessy - Run Flow")
    original = flows[0]
    source = (ROOT / "homeyscript/sessy-ready-by-17.js").read_text()
    patched, key = patch_flow(copy.deepcopy(original), source, os.environ["HOMEY_SESSY_DEVICE_ID"])
    flag = lookup(ENABLED, "boolean")
    state = lookup(STATE, "string")
    plan = lookup(PLAN, "string")
    print("Flow:", original["name"], "| normal calculation:", key)
    print("5 kWh, 1000 W grid top-up / up to 2200 W solar, 09:00–17:00 reserve, 45 min finish margin (Amsterdam)")
    print("Existing device commands/guards retained; script error -> zero target -> existing stop command")
    if not args.apply:
        print("Read-only preview. Use --apply to install and enable.")
        return

    backup_dir = ROOT / "build/homey-backups"
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backup_dir / ("sessy-run-before-ready-by-17-" + stamp + ".json")
    with open(backup, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as handle:
        json.dump(original, handle, ensure_ascii=False, indent=2)
    print("Private Flow backup:", backup)
    if flag is None:
        flag = write("POST", "/api/manager/logic/variable", {"name": ENABLED, "type": "boolean", "value": False})
    if state is None:
        state = write("POST", "/api/manager/logic/variable", {"name": STATE, "type": "string", "value": "{}"})
    if plan is None:
        plan = write("POST", "/api/manager/logic/variable", {"name": PLAN, "type": "string", "value": "{}"})
    path = "/api/manager/flow/advancedflow/" + original["id"]
    # Abort if somebody edited the Flow since the initial read.
    if flow_body(client.get(path)) != flow_body(original):
        raise RuntimeError("Flow changed during preparation; no Flow update applied")
    write("PUT", path, flow_body(patched))
    actual = client.get(path)
    if flow_body(actual) != flow_body(patched) or actual.get("broken"):
        write("PUT", path, flow_body(original))
        raise RuntimeError("Installation verification failed; original Flow restored")
    write("PUT", "/api/manager/logic/variable/" + flag["id"], {"value": True})
    verify = client.get("/api/manager/logic/variable/" + flag["id"])
    if verify.get("value") is not True:
        raise RuntimeError("Flow installed but enable flag could not be verified")
    if args.configure_readers:
        env_path = ROOT / ".env"
        lines = env_path.read_text().splitlines() if env_path.exists() else []
        name = "HOMEY_BATTERY_PLAN_VARIABLE_ID"
        lines = [line for line in lines if line.split("=", 1)[0].strip() != name]
        lines.append(name + "=" + plan["id"])
        env_path.write_text("\n".join(lines) + "\n")
        print("Configured plan variable ID in local .env (no credentials changed).")
    print("Installed, read-back verified and enabled. No manual Flow/device test was triggered.")


if __name__ == "__main__":
    main()
