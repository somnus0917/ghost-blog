#!/usr/bin/env python3
"""Build a deterministic, lightweight Ghost theme archive."""

from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_THEME = REPO_ROOT / "theme" / "somnus-yohaku"
DEFAULT_OUTPUT = REPO_ROOT / "build" / "somnus-yohaku.zip"
EXCLUDED_PARTS = {".DS_Store"}
EXCLUDED_FILES = {"MapleMono-NF-CN-Regular.woff2"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--theme", type=Path, default=DEFAULT_THEME)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    theme = args.theme.resolve()
    output = args.output.resolve()
    files = sorted(
        path
        for path in theme.rglob("*")
        if path.is_file()
        and path.name not in EXCLUDED_FILES
        and not (set(path.relative_to(theme).parts) & EXCLUDED_PARTS)
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            archive.write(path, path.relative_to(theme).as_posix())
    print(f"built theme: {len(files)} files, {output.stat().st_size} bytes")
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
