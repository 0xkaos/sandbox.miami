#!/usr/bin/env python3
"""Convert Jordan et al.'s wrapped supplementary pottery table into atlas JSON."""

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "public/threejs/human_atlas/data/pottery.txt"
OUTPUT = ROOT / "public/threejs/human_atlas/data/early-pottery-sites.json"
UNLOCATED_SITES = {"Istok 4"}


def normalized_table(raw: str) -> str:
    lines = raw.splitlines()
    kept = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if line == "SUPPLEMENTARY MATERIAL":
            index += 1
            if index < len(lines) and re.fullmatch(r"\d+", lines[index].strip()):
                index += 1
            while index < len(lines) and lines[index].strip() != "d?":
                index += 1
            index += 1
            continue
        if line:
            if re.fullmatch(r"\d{1,2}", line) and kept and re.search(r"±\d{1,2}$", kept[-1]):
                kept[-1] += line
            else:
                kept.append(line)
        index += 1
    return " ".join(kept)


def main() -> None:
    raw = INPUT.read_text(encoding="utf-8")
    table = normalized_table(raw)
    # Istok 4 has blank coordinate cells in the supplied supplementary table.
    table = table.replace("Istok 4 6620±260 7504 un", "Istok 4 0.0 0.0 6620±260 7504 un")
    pattern = re.compile(
        r"(?P<site>.*?)\s+(?P<lat>-?\d{1,2}\.\d+)\s+(?P<lon>-?\d{1,3}\.\d+)"
        r"\s+(?P<bp>\d{1,2},\d{3}|\d{3,5})\s*±\s*(?P<sd>\d{1,3})\s+(?P<cal>\d{4,5})"
        r"\s+(?P<economy>[A-Za-z/]+)(?:\s+(?P<retained>TRUE))?"
        r"(?=\s+.*?\s+-?\d{1,2}\.\d+\s+-?\d{1,3}\.\d+\s+(?:\d{1,2},\d{3}|\d{3,5})\s*±|$)"
    )
    matches = list(pattern.finditer(table))
    if "".join(match.group(0) for match in matches) != table or not matches:
        raise ValueError("The supplementary table did not parse completely.")
    records = []
    for number, match in enumerate(matches, 1):
        row = match.groupdict()
        lat, lon = float(row["lat"]), float(row["lon"])
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError(f"Invalid coordinate at row {number}: {row['site']}")
        is_unlocated = row["site"].strip() in UNLOCATED_SITES
        records.append({
            "id": f"pottery-{number:04d}", "site": row["site"].strip(), "lat": None if is_unlocated else lat, "lon": None if is_unlocated else lon,
            "radiocarbonBP": int(row["bp"].replace(",", "")), "radiocarbonSd": int(row["sd"]),
            "averageCalBPIntCal09": int(row["cal"]), "displayYear": 1950 - int(row["cal"]),
            "economy": row["economy"], "retainedByStudy": row["retained"] == "TRUE",
        })
    catalog = {
        "schemaVersion": 1,
        "source": {
            "title": "Early pottery and economy supplementary table", "citation": "Jordan et al., Antiquity 90 (2016), 1035-1049",
            "doi": "https://doi.org/10.15184/aqy.2016.68", "calibration": "Source-supplied average calibrated BP using IntCal09",
            "interpretation": "Timeline placement is 1950 minus the source-supplied average calibrated BP. It is a browsing point, not a calibrated interval or evidence of continuous occupation. Economy labels are transcribed verbatim; the study's Retained? flag is informational only.",
            "inputFile": "pottery.txt", "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(), "inputRows": len(records),
        },
        "records": records,
    }
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(records)} records to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()