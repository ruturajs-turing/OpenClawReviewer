#!/usr/bin/env python3
"""Convert persona_registry.csv → PersonaData.gs JavaScript object.

Usage:
    python3 convert_personas.py path/to/full_personas.csv

Output is printed to stdout. Redirect to a file or copy-paste into PersonaData.gs.
"""

import csv
import json
import sys

FIELDS_TO_KEEP = [
    "persona_id", "full_name", "job_title", "city", "age", "gender",
    "education", "cultural_bg", "language", "timezone", "sector",
    "contributor_type", "remote_status", "company", "company_hq",
    "household_status", "partner_name", "has_faith", "tradition",
    "region", "urbanicity", "platforms", "hobbies_tier1", "hobbies_tier2",
    "task_ids",
]


def convert(csv_path: str) -> str:
    entries = []

    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("full_name", "").strip()
            if not name:
                continue

            key = name.lower()
            fields = {}
            for field in FIELDS_TO_KEEP:
                val = row.get(field, "").strip()
                if val and val != "—":
                    fields[field] = val

            props = []
            for k, v in fields.items():
                escaped = json.dumps(v)
                props.append(f"    {k}: {escaped}")

            entry = f'  "{key}": {{\n' + ",\n".join(props) + "\n  }"
            entries.append(entry)

    body = ",\n\n".join(entries)

    return f"""var PERSONA_REGISTRY = {{
{body}
}};"""


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 convert_personas.py <csv_path>", file=sys.stderr)
        sys.exit(1)

    result = convert(sys.argv[1])
    print(result)
    print(f"\n// {len(sys.argv[1])} — {result.count('persona_id')} personas generated", file=sys.stderr)
