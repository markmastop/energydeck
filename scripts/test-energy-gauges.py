"""Verify signed power with the actual header arc configuration and built LVGL."""
import subprocess
import tempfile
from pathlib import Path
import yaml

root = Path(__file__).resolve().parents[1]
build = root / "esphome/.esphome/build/energydeck-simulator"
libraries = list((build / ".pioenvs/energydeck-simulator").glob("lib*/liblvgl.a"))
if not libraries:
    raise SystemExit("Build energydeck-simulator.yaml first.")
widgets = yaml.safe_load((root / "esphome/packages/energy-header-widgets.yaml").read_text())
config = []
for name, var in [("header_grid_arc", "grid"), ("header_source_arc", "source")]:
    arc = next(w["arc"] for w in widgets if w.get("arc", {}).get("id") == name)
    config.append(f'lv_arc_set_bg_angles({var}, {arc["start_angle"]}, {arc["end_angle"]});')
    config.append(f'lv_arc_set_range({var}, {arc.get("min_value", 0)}, {arc.get("max_value", 100)});')
    config.append(f'lv_arc_set_mode({var}, LV_ARC_MODE_{arc.get("mode", "NORMAL")});')
source = (root / "scripts/test-energy-gauges.cpp").read_text()
source = source.replace("// PRODUCTION_ARC_CONFIG", "\n".join(config))
source = source.replace('../esphome/components/ui_performance/energy_gauges.h',
                        str(root / 'esphome/components/ui_performance/energy_gauges.h'))
source = source.replace('../esphome/components/ui_performance/energy_history_chart.h',
                        str(root / 'esphome/components/ui_performance/energy_history_chart.h'))
with tempfile.TemporaryDirectory(prefix="energydeck-energy-gauges-") as temp:
    cpp, binary = Path(temp) / "gauges.cpp", Path(temp) / "test"
    cpp.write_text(source)
    subprocess.run(["c++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                    "-DLV_CONF_INCLUDE_SIMPLE", "-DLV_CONF_H=1", "-DLV_KCONFIG_IGNORE",
                    "-I" + str(build / "src"), "-I" + str(build / ".piolibdeps/energydeck-simulator/lvgl"),
                    str(cpp), str(libraries[0]), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
