#!/usr/bin/env python3
"""Verify the EV Flow migration against synthetic cards; no Homey connection."""
import copy
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('install_ev', Path(__file__).with_name('install-ev-six-hour-plan.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
flow = {'cards': {
    'gate': {'id': 'homey:manager:logic:equal_boolean', 'droptoken': 'homey:manager:logic|old',
             'outputTrue': ['allow'], 'outputFalse': ['stop']},
    'force': {'id': 'homey:manager:logic:equal_boolean', 'droptoken': 'homey:manager:logic|force', 'outputTrue': ['allow']},
    'timer': {'args': {'time': '01:30'}},
    'allow': {'args': {'enabled': True}}, 'stop': {'args': {'enabled': False}},
}}
original = copy.deepcopy(flow)
patched = installer.patch_flow(flow, 'old', 'new')
assert flow == original
expected = copy.deepcopy(flow)
expected['cards']['gate']['droptoken'] = 'homey:manager:logic|new'
assert patched == expected
for invalid in [{'cards': {}}, {'cards': {'a': flow['cards']['gate'], 'b': flow['cards']['gate']}}]:
    try:
        installer.patch_flow(invalid, 'old', 'new')
    except ValueError:
        continue
    raise AssertionError('Ambiguous/missing gate accepted')
print('PASS: only automatic gate changes; force, timer and outputs preserved; ambiguous topology rejected')
