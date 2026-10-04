#!/usr/bin/env python3
"""Build a narrow, R2-ready ROAD discovery partition for the Human Atlas.

The Kandel et al. reproducibility archive is intentionally kept outside this
repository. Its correlation export supplies assemblage-level inferred age
bounds; these are preserved as supplied and are not calibrated calendar dates.
"""
import argparse
import csv
import hashlib
import io
import json
import zipfile
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = Path('/tmp/human-atlas-research/Kandel_etal_2023.zip')
EXPECTED_SHA256 = 'c22c10fddafda86b4912e15ebeadefece9fc73151223cfd43799d47a155e69c0'
MEMBER = 'fig_coverage_temporal/road_coverage_correl.csv'
PREFIX = 'human-atlas/road/v1'

# A deliberately broad Near East working envelope, not a historical region.
MIN_LON, MAX_LON = 25, 60
MIN_LAT, MAX_LAT = 20, 42
# The target is approximately 50–20 ka BP, with a generous context horizon.
MIN_AGE_BP, MAX_AGE_BP = 15_000, 55_000


def number(value):
    if value is None or not value.strip():
        return None
    return float(value)


def compact_number(value):
    return int(value) if value.is_integer() else value


def display_category(value):
    """Choose one map symbol while retaining the complete source category."""
    text = (value or '').lower()
    if 'human remains' in text:
        return 'human-remains'
    if 'plant remains' in text:
        return 'plant-remains'
    if 'animal remains' in text or 'paleofauna' in text:
        return 'fauna'
    if any(term in text for term in ('raw material', 'technology', 'typology')):
        return 'lithics'
    return 'other'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')))


def source_rows(archive):
    with zipfile.ZipFile(archive) as bundle:
        with bundle.open(MEMBER) as stream:
            yield from csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig', newline=''), delimiter=';')


def partition_id(lon, lat):
    if -25 <= lon < 25 and 20 <= lat <= 72:
        return 'europe'
    if 25 <= lon < 65 and 15 <= lat <= 45:
        return 'west-asia'
    if -20 <= lon < 55 and -36 <= lat < 20:
        return 'north-africa'
    if 65 <= lon <= 110 and 15 <= lat <= 60:
        return 'central-asia'
    return 'other'


def record_from_row(row, ordinal):
    age_min = number(row['geological_stratigraphy.age_min'])
    age_max = number(row['geological_stratigraphy.age_max'])
    lon = number(row['locality.x'])
    lat = number(row['locality.y'])
    if None in (age_min, age_max, lon, lat) or age_min > age_max:
        return None
    return {
        'id': f'road-{ordinal:05d}',
        'locality': row['locality.idlocality'],
        'assemblage': row['assemblage.name'],
        'evidenceCategory': row['assemblage.category'] or None,
        'displayCategory': display_category(row['assemblage.category']),
        'hasHumanRemainsCategory': 'human remains' in (row['assemblage.category'] or '').lower(),
        'correlation': row['geological_stratigraphy.correlation'] or None,
        'ageRangeBP': [compact_number(age_min), compact_number(age_max)],
        'displayRange': [compact_number(1950 - age_max), compact_number(1950 - age_min)],
        'lat': round(lat, 6),
        'lon': round(lon, 6),
    }


def build_records(archive, pilot_only=False):
    records = []
    for row in source_rows(archive):
        record = record_from_row(row, len(records) + 1)
        if record is None:
            continue
        if pilot_only:
            if not (MIN_LON <= record['lon'] <= MAX_LON and MIN_LAT <= record['lat'] <= MAX_LAT):
                continue
            if record['ageRangeBP'][0] > MAX_AGE_BP or record['ageRangeBP'][1] < MIN_AGE_BP:
                continue
            record['id'] = f"road-ne-pilot-{len(records) + 1:04d}"
        records.append(record)
    return records


def source_metadata(digest):
    return {
        'dataset': 'ROCEEH Out of Africa Database (ROAD) derived export',
        'archive': 'Kandel_etal_2023.zip',
        'archiveSha256': digest,
        'member': MEMBER,
        'license': None,
        'distributionStatus': 'Approved for public distribution after reuse review.',
        'interpretation': 'One record is one ROAD assemblage with correlation-derived age bounds. ageRangeBP retains the supplied bounds in years BP. displayRange only places that interval on the atlas calendar axis using 1950 CE as BP zero; it is not a calibrated date. displayCategory selects one map symbol but retains the complete source evidenceCategory. Evidence-category text such as human remains does not identify a hominin taxon. Records do not establish continuous occupation, ancestry, migration, culture boundaries, language, or population.',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, default=CACHE)
    parser.add_argument('--output', type=Path, default=ROOT / 'tmp' / 'human-atlas-road-r2' / 'v1')
    parser.add_argument('--scope', choices=('pilot', 'full'), default='pilot')
    args = parser.parse_args()

    source = args.archive.read_bytes()
    digest = hashlib.sha256(source).hexdigest()
    if digest != EXPECTED_SHA256:
        raise ValueError(f'Unexpected Kandel archive checksum: {digest}')

    records = build_records(args.archive, pilot_only=args.scope == 'pilot')
    if not records:
        raise ValueError('No ROAD records matched the Near East pilot rule')
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('ROAD pilot IDs are not unique')

    args.output.mkdir(parents=True, exist_ok=True)
    selection = {
        'kind': 'broad Near East context horizon',
        'longitude': [MIN_LON, MAX_LON],
        'latitude': [MIN_LAT, MAX_LAT],
        'targetAgeBP': [20_000, 50_000],
        'contextOverlapBP': [MIN_AGE_BP, MAX_AGE_BP],
        'rule': 'Coordinates inside the working envelope; supplied age bounds overlap the 15–55 ka BP context horizon. This is not a hard 50–20 ka filter or a historical regional boundary.',
    }
    if args.scope == 'full':
        selection = {
            'kind': 'full mappable ROAD correlation export',
            'rule': 'Rows require coordinates and supplied age_min/age_max values. No chronology, taxon, cultural-period, or geographic filter is applied before partitioning.',
        }
    partition = {
        'schemaVersion': 1,
        'source': source_metadata(digest),
        'selection': selection,
        'records': records,
    }
    if args.scope == 'full':
        partitions = {}
        for record in records:
            partitions.setdefault(partition_id(record['lon'], record['lat']), []).append(record)
        manifest_partitions = []
        for identifier, rows in sorted(partitions.items()):
            partition_path = args.output / f'{identifier}.json'
            write_json(partition_path, {**partition, 'partition': identifier, 'records': rows})
            manifest_partitions.append({
                'id': identifier, 'key': f'{PREFIX}/{identifier}.json', 'localFile': partition_path.name,
                'sha256': hashlib.sha256(partition_path.read_bytes()).hexdigest(), 'bytes': partition_path.stat().st_size,
                'records': len(rows), 'localities': len({record['locality'] for record in rows}),
            })
        manifest = {
            'schemaVersion': 1, 'dataset': 'Human Atlas ROAD explorer', 'prefix': PREFIX,
            'status': 'public-distribution-approved', 'sourceArchiveSha256': digest,
            'partitions': manifest_partitions,
            'counts': {'records': len(records), 'localities': len({record['locality'] for record in records})},
            'notice': 'Partitions are discovery indexes, not claims that all records are comparably dated or taxonomically resolved.',
        }
        write_json(args.output / 'manifest.json', manifest)
        print(f'ROAD explorer: {len(records)} assemblages at {manifest["counts"]["localities"]} localities in {len(manifest_partitions)} partitions')
        print(f'Staged: {args.output}')
        return
    partition_name = 'near-east-50-20ka.json'
    partition_path = args.output / partition_name
    write_json(partition_path, partition)
    partition_sha256 = hashlib.sha256(partition_path.read_bytes()).hexdigest()
    localities = {record['locality'] for record in records}
    categories = Counter(record['evidenceCategory'] or 'Unspecified' for record in records)
    manifest = {
        'schemaVersion': 1,
        'dataset': 'Human Atlas ROAD discovery pilot',
        'prefix': PREFIX,
        'status': 'public-distribution-approved',
        'sourceArchiveSha256': digest,
        'partitions': [{
            'id': 'near-east-50-20ka',
            'key': f'{PREFIX}/near-east-50-20ka.json',
            'localFile': partition_name,
            'sha256': partition_sha256,
            'bytes': partition_path.stat().st_size,
            'records': len(records),
            'localities': len(localities),
            'selection': partition['selection'],
        }],
        'counts': {
            'records': len(records),
            'localities': len(localities),
            'recordsWithHumanRemainsCategory': sum('human remains' in (record['evidenceCategory'] or '').lower() for record in records),
            'evidenceCategories': dict(sorted(categories.items())),
        },
        'notice': 'The manifest is a discovery index, not a claim that all records are comparably dated or taxonomically resolved.',
    }
    write_json(args.output / 'manifest.json', manifest)
    print(f'ROAD pilot: {len(records)} assemblages at {len(localities)} localities')
    print(f'Staged: {args.output}')


if __name__ == '__main__':
    main()