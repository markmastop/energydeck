"""Offline verification of the production Flow migration, without Homey calls."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install-sessy-ready-by-17.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.source = (installer.ROOT / "homeyscript/sessy-ready-by-17.js").read_text()
        self.flow = {"id": "flow", "name": "Sessy - Run", "enabled": True, "cards": {
            "normal": {"id": "homey:manager:logic:variable_set_number_math", "ownerUri": "homey:manager:logic",
                "args": {"variable": {"id": "target", "name": "sessy_doel_vermogen"}, "value": "{{ (previous*2/3) + demand/3}}"},
                "type": "action", "x": 100, "y": 200, "outputSuccess": ["guard"]},
            "guard": {"type": "condition", "id": "keep-existing-price-and-soc-guards", "outputTrue": ["actuator"]},
            "actuator": {"id": "homey:device:battery:set_power_setpoint", "ownerUri": "homey:device:battery", "args": {"setpoint": "existing-target-token"}},
            "manual": {"type": "start", "outputSuccess": ["actuator"]},
        }}

    def test_only_normal_calculation_changes_and_error_stops(self):
        old = copy.deepcopy(self.flow)
        flow, key = installer.patch_flow(self.flow, self.source, "battery")
        self.assertEqual(key, "normal")
        for name in ["guard", "actuator", "manual"]:
            self.assertEqual(flow["cards"][name], old["cards"][name])
        self.assertEqual(flow["cards"]["normal"]["outputSuccess"], ["guard"])
        fallback = flow["cards"][installer.ERROR_NODE]
        self.assertEqual(fallback["args"]["value"], 0)
        self.assertEqual(fallback["outputSuccess"], ["guard"])
        self.assertNotIn("__SESSY_DEVICE_ID__", flow["cards"]["normal"]["args"]["code"])
        repeated, _ = installer.patch_flow(copy.deepcopy(flow), self.source, "battery")
        self.assertEqual(repeated, flow)

    def test_reject_wrong_device_and_unexpected_controller(self):
        with self.assertRaises(ValueError):
            installer.patch_flow(copy.deepcopy(self.flow), self.source, "another-battery")
        self.flow["cards"]["normal"]["args"]["value"] = "different algorithm"
        with self.assertRaises(ValueError):
            installer.patch_flow(self.flow, self.source, "battery")


if __name__ == "__main__":
    unittest.main()
