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
selection = music.split("  - id: select_music_system\n", 1)[1].split("  - id: apply_music_group\n", 1)[0]
selection_body = selection.split("            - lambda: |-\n", 1)[1].split("            - script.execute: render_music", 1)[0]
selection_body = "\n".join(line[16:] if line.startswith("                ") else line for line in selection_body.splitlines())
source = source.replace("// PRODUCTION_ROOM_SELECT", selection_body)
requests = music.split("  - id: sonos_requests\n", 1)[1].split("  - id: refresh_music\n", 1)[0]
guards = [line.split("lambda: ", 1)[1] for line in requests.splitlines() if "lambda: return" in line]
# Evaluate both the loop guard and the guard after waiting for another owner.
source = source.replace("// PRODUCTION_REQUEST_GUARD", guards[0])
source = source.replace("// PRODUCTION_SUBMIT_GUARD", guards[2])
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
