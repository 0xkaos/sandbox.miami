#!/usr/bin/env python3
"""Build a compact, dated southern-Levant archaeological site layer.

The input is pinned to a reviewed version of Titolo and Palmisano's
"From Villages to Empires" dataset. No inferred polity or excavation claims
are added. One source row remains one occupation phase in the output.
"""

import csv
import hashlib
import io
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/levant-sites.json'
CACHE = Path('/tmp/human-atlas-source/levant-sites.csv')
REVISION = 'a3537c67cc736fb929291c50a4928a0cd7136dd9'
URL = f'https://raw.githubusercontent.com/UnitoAssyrianGovernance/villages-to-empire-dataset/{REVISION}/dataset/archaeo_sites.csv'
SHA256 = 'baabd1a5d6da2b7fdfca70662b3de03563c4a9b4d238ee6018022eaad66939c9'

# Site rows: [id, sourceSiteId, name, alternativeName, ancientName, lat, lon,
#             locationQuality, region, phaseOffset, phaseCount]
# Phase rows: [start, end, period, type, morphology, subtype, status, sizeHa,
#              sizeQuality, source, pages, sourceId, altSource, altPages,
#              altSourceId, notes]
# Strings in all columns except site name, IDs and page references are interned
# in dictionaries. Index 0 means an empty source field.
SITE_COLUMNS = ['id', 'sourceSiteId', 'name', 'alternativeName', 'ancientName',
                'lat', 'lon', 'locationQuality', 'region', 'phaseOffset', 'phaseCount']
PHASE_COLUMNS = ['start', 'end', 'period', 'type', 'morphology', 'subtype', 'status',
                 'sizeHa', 'sizeQuality', 'source', 'pages', 'sourceId',
                 'alternativeSource', 'alternativePages', 'alternativeSourceId', 'notes']
DICTIONARY_COLUMNS = ['locationQuality', 'region', 'period', 'type', 'morphology',
                      'subtype', 'status', 'sizeQuality', 'source',
                      'alternativeSource', 'notes']


def source_bytes():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'Human Atlas data preparation'})
        with urllib.request.urlopen(request, timeout=60) as response:
            CACHE.write_bytes(response.read())
    data = CACHE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise ValueError(f'Levant site source checksum changed: {digest}')
    return data


def number(value):
    return float(value) if value else None


def optional_text(value):
    text = (value or '').strip()
    return '' if text.casefold() in ('na', 'false', '-') else text


def main():
    rows = list(csv.DictReader(io.StringIO(source_bytes().decode('utf-8-sig'))))
    if not rows or len(rows) != 14273:
        raise ValueError(f'Unexpected Levant source row count: {len(rows)}')
    tables = {column: [''] for column in DICTIONARY_COLUMNS}
    positions = {column: {'': 0} for column in DICTIONARY_COLUMNS}

    def intern(column, value):
        value = (value or '').strip()
        if value not in positions[column]:
            positions[column][value] = len(tables[column])
            tables[column].append(value)
        return positions[column][value]

    grouped = defaultdict(list)
    missing_coordinates = 0
    for source_row in rows:
        if not source_row['Latitude'] or not source_row['Longitude']:
            missing_coordinates += 1
            continue
        # Source SiteID alone collides across different places in the release.
        # Include the name and coordinates so unrelated sites never merge.
        key = (source_row['Region'], source_row['SiteID'], source_row['Name'],
               source_row['Latitude'], source_row['Longitude'])
        grouped[key].append(source_row)

    sites, phases = [], []
    for key, records in grouped.items():
        first = records[0]
        start_at = len(phases)
        for item in sorted(records, key=lambda r: (int(r['StartDate']), int(r['EndDate']), r['Period'])):
            size = number(item['SizeHa'])
            phases.append([
                int(item['StartDate']), int(item['EndDate']),
                intern('period', item['Period']), intern('type', item['Type']),
                intern('morphology', item['Morphology']), intern('subtype', item['Subtype']),
                intern('status', item['ArchaeoStatus']), round(size, 3) if size is not None else None,
                intern('sizeQuality', item['SizeQual']), intern('source', item['Source']),
                optional_text(item['Pages']), optional_text(item['SourceID']),
                intern('alternativeSource', optional_text(item['AltSource'])), optional_text(item['AltSourcePages']),
                optional_text(item['AltSourceID']), intern('notes', optional_text(item['Notes'])),
            ])
        sites.append([
            f'lev-{len(sites)+1}', first['SiteID'].strip(), first['Name'].strip(),
            optional_text(first['NameAlt']), optional_text(first['AncientName']),
            round(float(first['Latitude']), 6), round(float(first['Longitude']), 6),
            intern('locationQuality', first['LocQual']), intern('region', first['Region']),
            start_at, len(records),
        ])

    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'From Villages to Empires: Archaeological Settlements of the South Levant',
            'authors': 'Andrea Titolo and Alessio Palmisano',
            'paper': 'https://doi.org/10.5334/joad.158',
            'repository': 'https://github.com/UnitoAssyrianGovernance/villages-to-empire-dataset',
            'revision': REVISION, 'url': URL, 'sha256': SHA256,
            'license': 'CC BY 4.0',
            'coverage': 'Surveyed area in Samaria and Judah only; approximately 31.13–32.57°N, 34.48–35.57°E.',
            'interpretation': 'Each phase indicates reported archaeological activity in a broad period, not continuous occupation throughout every year. Subtype lists site features, not an itemized finds assemblage.',
            'locationQualityCodes': {'A': 'Exact site centroid', 'B': 'Within 1 km of coordinates',
                                     'C': 'Within 3 km of coordinates', 'D': 'Within 5 km of coordinates'},
            'sizeQualityCodes': {'A': 'High-confidence phase estimate from intensive survey, excavation or geomorphology',
                                 'B': 'Rough phase estimate from limited survey or subsurface knowledge',
                                 'C': 'Same estimated size used for all phases; phase-specific extent uncertain',
                                 'D': 'Very rough estimate by the source project'},
            'missingCoordinatePhases': missing_coordinates,
        },
        'columns': {'site': SITE_COLUMNS, 'phase': PHASE_COLUMNS},
        'dictionary': tables,
        'sites': sites,
        'phases': phases,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(sites):,} site records, {len(phases):,} phases, {missing_coordinates} phases with no coordinates skipped')
    print(f'{OUT}: {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
