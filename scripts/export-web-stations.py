"""Export the display's existing station JPEGs for the web app, without downloading."""

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "esphome/components/online_image"
OUTPUT = ROOT / "web/public/stations"


def export(source, symbol, key):
    match = re.search(r"inline constexpr uint8_t " + re.escape(symbol) + r"\[\] = \{(.*?)\};", source, re.S)
    if not match:
        raise ValueError(f"Missing embedded station image: {symbol}")
    raw = bytes(int(byte, 16) for byte in re.findall(r"0x([a-fA-F0-9]{2})", match[1]))
    if not raw.startswith(b"\xff\xd8") or not raw.endswith(b"\xff\xd9"):
        raise ValueError(f"Invalid JPEG: {symbol}")
    (OUTPUT / f"{key}.jpg").write_bytes(raw)


if __name__ == "__main__":
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = (SOURCE / "station_logos.h").read_text()
    for station in json.loads((SOURCE / "station_logos.json").read_text()):
        export(source, "STATION_" + station["key"].upper().replace("-", "_") + "_LOGO", station["key"])
    export((SOURCE / "radionl_logo.h").read_text(), "RADIONL_LOGO", "radionl")
    print("Exported eleven existing station logos.")
