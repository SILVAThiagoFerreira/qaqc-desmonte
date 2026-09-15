"""Create the small, browser-friendly fixture used by the static dashboard.

The original workbook is intentionally kept out of the public repository. This
script is also the repeatable local validation path when a new template is
received from operations.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, time
from pathlib import Path

from openpyxl import load_workbook


def serialise(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value


def extract(input_path: Path, output_path: Path) -> None:
    workbook = load_workbook(input_path, read_only=True, data_only=True)
    sheets = {}
    for worksheet in workbook.worksheets:
        rows = list(worksheet.iter_rows(values_only=True))
        if not rows:
            sheets[worksheet.title] = {"headers": [], "rows": []}
            continue
        headers = [serialise(value) for value in rows[0]]
        body = [[serialise(value) for value in row] for row in rows[1:]]
        sheets[worksheet.title] = {"headers": headers, "rows": body}
    workbook.close()

    payload = {
        "meta": {
            "sourceFile": input_path.name,
            "generatedAt": datetime.now().astimezone().isoformat(),
            "sheets": list(sheets),
        },
        "sheets": sheets,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    extract(args.input, args.output)
    print(f"fixture={args.output} bytes={args.output.stat().st_size}")


if __name__ == "__main__":
    main()
