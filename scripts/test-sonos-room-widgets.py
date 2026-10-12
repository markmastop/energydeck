"""Run the production room-render lambda against the simulator's built LVGL."""
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build = root / "esphome/.esphome/build/energydeck-simulator"
libraries = list((build / ".pioenvs/energydeck-simulator").glob("lib*/liblvgl.a"))
if not libraries:
    raise SystemExit("Build energydeck-simulator.yaml first to obtain its LVGL library.")
music = (root / "esphome/packages/music.yaml").read_text()
section = music.split("  - id: render_music_systems\n", 1)[1].split("  - id: sonos_favorite_requests\n", 1)[0]
body = section.split("      - lambda: |-\n", 1)[1]
body = "\n".join(line[10:] if line.startswith("          ") else line for line in body.splitlines())
source = (root / "scripts/test-sonos-room-widgets.cpp").read_text().replace("// PRODUCTION_ROOM_RENDER", body)
with tempfile.TemporaryDirectory(prefix="energydeck-room-widgets-") as temp:
    cpp = Path(temp) / "room-widgets.cpp"
    # Resolve the model include relative to the checked-in test, not the temp dir.
    source = source.replace('../esphome/components/sonos_local/sonos_local.h', str(root / "esphome/components/sonos_local/sonos_local.h"))
    cpp.write_text(source)
    binary = Path(temp) / "test"
    subprocess.run(["c++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
                    "-DLV_CONF_INCLUDE_SIMPLE", "-DLV_CONF_H=1", "-DLV_KCONFIG_IGNORE", "-I" + str(build / "src"),
                    "-I" + str(build / ".piolibdeps/energydeck-simulator/lvgl"),
                    str(cpp), str(libraries[0]), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
