#!/usr/bin/env python3
"""Check the actual Xtensa setup() frame against half the configured loop stack.

An OTA upload can succeed even when setup() immediately exhausts the device stack.
Use after a target compile; this inspects machine code, not source-size estimates.
"""
import argparse
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path, help="ESPHome generated target directory (contains src/ and build/)")
    parser.add_argument("--object", type=Path, help="Optional earlier main.cpp.obj for regression comparison")
    args = parser.parse_args()
    generated = args.build.resolve()
    defines = (generated / "src/esphome/core/defines.h").read_text()
    stack = int(re.search(r"^#define ESPHOME_LOOP_TASK_STACK_SIZE (\d+)$", defines, re.M)[1])
    cache = (generated / "build/CMakeCache.txt").read_text()
    objdump = re.search(r"^CMAKE_OBJDUMP:FILEPATH=(.+)$", cache, re.M)[1]
    obj = args.object or generated / "build/esp-idf/src/CMakeFiles/__idf_src.dir/main.cpp.obj"
    output = subprocess.run([objdump, "-d", "-C", str(obj)], check=True, capture_output=True, text=True).stdout
    setup = re.search(r"^[0-9a-f]+ <setup\(\)>:\n((?:.*\n){1,5})", output, re.M)
    frame = re.search(r"\bentry\s+a1,\s*(0x[0-9a-f]+|\d+)\b", setup[1] if setup else "")
    if not frame:
        raise SystemExit("Cannot inspect Xtensa setup() frame; do not silently skip this check.")
    size = int(frame[1], 0)
    budget = stack // 2
    ok = size <= budget
    print(f"{'PASS' if ok else 'FAIL'}: setup() frame {size} B; budget {budget} B of {stack} B loop stack")
    if not ok:
        raise SystemExit("Insufficient space remains for setup callers/callees. Avoid large by-value global initializers.")


if __name__ == "__main__":
    main()
