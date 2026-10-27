#!/usr/bin/env python3
"""Preview or activate six-hour EV permission; preserve force and 01:30 paths.

Read-only unless --apply is provided. Never invokes a charging Flow directly;
running the price publisher after activation lets Auto - Run apply its policy.
"""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import subprocess
import urllib.request

sys.dont_write_bytecode = True
from homey_discover import HomeyClient, load_env, values

ROOT = Path(__file__).resolve().parents[1]
PERMISSION = 'Energie - EV zesuursplan toegestaan'


def patch_flow(flow, old_id, new_id):
    patched = copy.deepcopy(flow)
    gates = [c for c in patched['cards'].values()
             if c.get('id') == 'homey:manager:logic:equal_boolean'
             and c.get('droptoken') == 'homey:manager:logic|' + old_id]
    if len(gates) != 1:
        raise ValueError('Expected exactly one legacy cheapest-seven-hours gate')
    # Change only the price condition token, retaining every connection/override.
    gates[0]['droptoken'] = 'homey:manager:logic|' + new_id
    return patched


def flow_body(flow):
    return {k: flow[k] for k in ['name', 'folder', 'enabled', 'cards'] if k in flow}


def script_body(script):
    return {k: script[k] for k in ['name', 'code', 'version'] if k in script}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    load_env()
    client = HomeyClient(os.environ['HOMEY_ADDRESS'].rstrip('/'), os.environ['HOMEY_TOKEN'])

    def write(method, path, body):
        req = urllib.request.Request(client.address + path, method=method,
            data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + client.token,
            'Content-Type': 'application/json', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=45, context=client.ssl_context) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    variables = list(values(client.get('/api/manager/logic/variable')))
    def variable(name):
        found = [v for v in variables if v['name'] == name]
        if len(found) > 1:
            raise ValueError('Ambiguous variable: ' + name)
        return found[0] if found else None

    flows = list(values(client.get('/api/manager/flow/advancedflow')))
    def active_flow(name):
        found = [f for f in flows if f['name'] == name and f.get('enabled') and not f.get('broken')]
        if len(found) != 1:
            raise ValueError('Expected one healthy enabled Flow: ' + name)
        return found[0]
    flow, force = active_flow('Auto - Run'), active_flow('Auto - Laden Forceren')
    if not any(c.get('args', {}).get('time') == '01:30' for c in force['cards'].values()):
        raise ValueError('Expected existing 01:30 override')
    if os.environ.get('HOMEY_CHARGE_FLOW_ID') != force['id']:
        raise ValueError('Configured manual charge button does not target the verified force Flow')
    scripts = [s for s in values(client.get('/api/app/com.athom.homeyscript/script'))
               if s['name'] == 'EnergieActuelePrijs']
    if len(scripts) != 1:
        raise ValueError('Expected one current-price publisher')
    script_path = '/api/app/com.athom.homeyscript/script/' + scripts[0]['id']
    script = client.get(script_path)
    source = (ROOT / 'homeyscript/energie-actuele-prijs.js').read_text()
    # Refuse to overwrite out-of-repository live edits during the first migration.
    previous_source = subprocess.check_output(
        ['git', 'show', 'HEAD:homeyscript/energie-actuele-prijs.js'], cwd=ROOT, text=True)
    if script['code'].strip() not in [source.strip(), previous_source.strip()]:
        raise ValueError('Live publisher differs from both the checked-in and proposed source')
    old = variable('Energie - Goedkoopste 7 uren')
    permission = variable(PERMISSION)
    if not old or old['type'] != 'boolean' or permission and permission['type'] != 'boolean':
        raise ValueError('Missing or incompatible permission variable')
    already = permission and any(c.get('droptoken') == 'homey:manager:logic|' + permission['id']
                                 for c in flow['cards'].values())
    patched = copy.deepcopy(flow) if already else patch_flow(flow, old['id'], permission['id'] if permission else 'PREVIEW')
    print('Six consecutive hours per Amsterdam day/night; exact client planner policy.')
    print('Preserve every Flow card/connection except the automatic price-condition token.')
    print('Verified manual button target and existing enabled 01:30 force rule.')
    if not args.apply:
        print('Read-only preview. --apply activates actual scheduled charging permission.')
        return

    directory = ROOT / 'build/homey-backups'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = directory / ('ev-before-six-hour-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json')
    with open(backup, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump({'flow': flow, 'force': force, 'script': script, 'permission': permission}, out)
    print('Private rollback backup:', backup)
    if not permission:
        permission = write('POST', '/api/manager/logic/variable',
                           {'name': PERMISSION, 'type': 'boolean', 'value': False})
    if not already:
        patched = patch_flow(flow, old['id'], permission['id'])
    flow_path = '/api/manager/flow/advancedflow/' + flow['id']
    try:
        write('PUT', script_path, {**script_body(script), 'code': source})
        if client.get(script_path)['code'] != source:
            raise RuntimeError('Publisher read-back mismatch')
        write('PUT', flow_path, flow_body(patched))
        if flow_body(client.get(flow_path)) != flow_body(patched):
            raise RuntimeError('Flow read-back mismatch')
        if client.get('/api/manager/flow/advancedflow/' + force['id']) != force:
            raise RuntimeError('Force Flow changed concurrently')
    except Exception:
        # Restore the original policy if verification fails before activation.
        write('PUT', flow_path, flow_body(flow))
        write('PUT', script_path, script_body(script))
        raise
    # Publishing last changes Prijsupdate, causing the existing Flow to re-evaluate.
    # This can change real permission; never call the force Flow as a test.
    result = write('POST', script_path + '/run', {'args': []})
    if not result.get('success') or not result.get('returns', {}).get('ok'):
        raise RuntimeError('Installed but publisher activation was not confirmed; inspect backup and live state')
    print('Activated publisher:', json.dumps(result.get('returns')))
    current = client.get('/api/manager/devices/device/' + os.environ['HOMEY_CHARGER_DEVICE_ID'])
    print('Charger:', json.dumps({k: current.get('capabilitiesObj', {}).get(k, {}).get('value')
        for k in ['is_connected', 'is_allowed', 'is_charging', 'measure_power']}))
    print('Force button and 01:30 Flow read-back unchanged.')


if __name__ == '__main__':
    main()
