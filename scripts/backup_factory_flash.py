#!/usr/bin/env python3
"""Read an ESP flash in retryable chunks and assemble a verified backup."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--baud", type=int, default=230400)
    parser.add_argument("--size", type=lambda value: int(value, 0), default=0x1000000)
    parser.add_argument("--chunk-size", type=lambda value: int(value, 0), default=0x100000)
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    if args.size % args.chunk_size:
        parser.error("--size must be divisible by --chunk-size")

    chunks_dir = args.output.parent / f".{args.output.name}.parts"
    chunks_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    esptool = [sys.executable, "-m", "esptool", "--port", args.port, "--baud", str(args.baud)]

    for offset in range(0, args.size, args.chunk_size):
        part = chunks_dir / f"{offset:08x}.bin"
        if part.exists() and part.stat().st_size == args.chunk_size:
            print(f"Using existing block 0x{offset:08x}", flush=True)
            continue

        for attempt in range(1, args.retries + 1):
            print(f"Reading block 0x{offset:08x} ({attempt}/{args.retries})", flush=True)
            result = subprocess.run(
                esptool
                + ["read-flash", hex(offset), hex(args.chunk_size), str(part)],
                check=False,
            )
            if result.returncode == 0 and part.exists() and part.stat().st_size == args.chunk_size:
                break
        else:
            print(f"Failed to read block 0x{offset:08x}", file=sys.stderr)
            return 1

    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("wb") as target:
        for offset in range(0, args.size, args.chunk_size):
            target.write((chunks_dir / f"{offset:08x}.bin").read_bytes())
    if temporary.stat().st_size != args.size:
        print("Assembled backup has the wrong size", file=sys.stderr)
        return 1
    temporary.replace(args.output)

    print(f"Backup: {args.output}")
    print(f"Size: {args.output.stat().st_size} bytes")
    print(f"SHA-256: {sha256(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
