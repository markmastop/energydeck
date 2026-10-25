#!/usr/bin/env python3
"""Guard startup/time-sync paths: device boot actions override package hooks."""
from pathlib import Path
import yaml
import re

root = Path(__file__).resolve().parents[1]
class Loader(yaml.SafeLoader):
    pass
Loader.add_multi_constructor('!', lambda loader, suffix, node: loader.construct_scalar(node))

def executes(value, name):
    if isinstance(value, dict):
        return value.get('script.execute') == name or any(executes(v, name) for v in value.values())
    return isinstance(value, list) and any(executes(v, name) for v in value)

for config in ['energydeck-crowpanel.yaml', 'energydeck-simulator.yaml']:
    source=re.sub(r'(?m)^ +<<:.*\n','',(root / 'esphome' / config).read_text())
    data = yaml.load(source, Loader=Loader)
    if config == 'energydeck-crowpanel.yaml':
        assert executes(data['esphome']['on_boot'], 'refresh_battery_history'), 'Device boot replaces package actions'
    assert executes(data['time'], 'refresh_battery_history'), 'First valid clock must trigger measured history'
print('PASS: production boot and both time-sync paths explicitly fetch battery history')
