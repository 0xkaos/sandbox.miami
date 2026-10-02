#!/usr/bin/env python3
"""Build selected, dated archaeological sample evidence from AADR annotations.

The Atlas subset is selected by source Group ID labels, which are retained
verbatim. AADR samples are evidence at an excavated locality, not a culture map.
"""

import csv
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/aadr-archaeological-samples.json'
CACHE = Path('/tmp/human-atlas-source/aadr-v66.p1.PUB.anno')
FILE_ID = '13994515'
URL = f'https://dataverse.harvard.edu/api/access/datafile/{FILE_ID}'
LABEL_PATTERN = re.compile(
    r'(?:^|_)(?:yamnaya|catacomb|sintashta|urnfield|hallstatt|la[ _-]?tene|'
    r'wielbark|mycenaean|phoenician|punic|etruscan|roman)(?:_|$)',
    re.IGNORECASE,
)
RANGE_PATTERN = re.compile(r'(\d+)\s*-\s*(\d+)\s+(cal)?(BCE|CE)')
SINGLE_YEAR_PATTERN = re.compile(r'^(\d+)\s+(BCE|CE)$')


def source_bytes():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'Human Atlas data preparation'})
        with urllib.request.urlopen(request, timeout=60) as response:
            CACHE.write_bytes(response.read())
    return CACHE.read_bytes()


def date_range(full_date, mean_bp, standard_deviation):
    text = (full_date or '').strip()
    match = RANGE_PATTERN.search(text)
    if match:
        first, second, _, era = match.groups()
        first, second = int(first), int(second)
        years = [-first, -second] if era == 'BCE' else [first, second]
        return (sorted(years), 'calibrated range' if 'cal' in text else 'archaeological context range')
    match = SINGLE_YEAR_PATTERN.match(text)
    if match:
        year, era = match.groups()
        return ([(-int(year) if era == 'BCE' else int(year))] * 2, 'dated historical event')
    if mean_bp:
        mean = round(1950 - float(mean_bp))
        deviation = round(float(standard_deviation or 0) * 2)
        return ([mean - deviation, mean + deviation], 'AADR date mean plus two standard deviations')
    return (None, None)


def columns(fieldnames):
    prefixes = {
        'id': 'Genetic ID (', 'skeletalCode': 'Skeletal code', 'skeletalElement': 'Skeletal element',
        'publication': 'Publication abbreviation', 'publicationDOI': 'doi for publication',
        'dateType': 'Method for Determining Date', 'dateMeanBP': 'Date mean in BP',
        'dateStandardDeviationBP': 'Date standard deviation in BP', 'fullDate': 'Full Date One',
    }
    result = {}
    for name, prefix in prefixes.items():
        result[name] = next((field for field in fieldnames if field.startswith(prefix)), None)
        if result[name] is None:
            raise ValueError(f'AADR annotation column missing: {prefix}')
    return result


def main():
    data = source_bytes()
    digest = hashlib.sha256(data).hexdigest()
    rows = csv.DictReader(data.decode('utf-8-sig').splitlines(), delimiter='\t')
    column = columns(rows.fieldnames or [])
    records = []
    for row in rows:
        label = row.get('Group ID', '').strip()
        if not LABEL_PATTERN.search(label):
            continue
        site = row.get('Locality', '').strip()
        latitude, longitude = row.get('Latitude', '').strip(), row.get('Longitude', '').strip()
        date, date_basis = date_range(row[column['fullDate']], row[column['dateMeanBP']], row[column['dateStandardDeviationBP']])
        if not site or not latitude or not longitude or date is None:
            continue
        records.append({
            'id': row[column['id']],
            'sourceLabel': label,
            'site': site,
            'country': row.get('Political Entity', '').strip(),
            'lat': round(float(latitude), 6), 'lon': round(float(longitude), 6),
            'dateRange': date, 'dateBasis': date_basis,
            'fullDate': row[column['fullDate']].strip(),
            'dateType': row[column['dateType']].strip(),
            'dateMeanBP': row[column['dateMeanBP']].strip(),
            'dateStandardDeviationBP': row[column['dateStandardDeviationBP']].strip(),
            'skeletalCode': row[column['skeletalCode']].strip(),
            'skeletalElement': row[column['skeletalElement']].strip(),
            'publication': row[column['publication']].strip(),
            'publicationDOI': row[column['publicationDOI']].strip(),
        })
    records.sort(key=lambda record: (record['dateRange'][0], record['sourceLabel'], record['id']))
    if not records:
        raise ValueError('No selected AADR records were imported')
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('AADR Genetic IDs are not unique')
    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'Allen Ancient DNA Resource v66.1 public annotations',
            'repository': 'https://doi.org/10.7910/DVN/FFIDCW',
            'file': 'v66.p1_1240K.aadr.PUB.anno', 'fileId': FILE_ID,
            'url': URL, 'sha256': digest, 'license': 'CC0 1.0',
            'selection': 'Rows with a source Group ID containing Yamnaya, Catacomb, Sintashta, Urnfield, Hallstatt, La Tene, Wielbark, Mycenaean, Phoenician, Punic, Etruscan, or Roman.',
            'interpretation': 'One record is an AADR ancient individual sample at a source locality. The retained Group ID is a source-provided archaeological or chronological label. It does not define a culture boundary, population, language, or route.',
        },
        'records': records,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(records):,} AADR archaeological sample records')
    print(f'{OUT}: {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()