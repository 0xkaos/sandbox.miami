#!/usr/bin/env python3
"""Build linked PaleoHumans Upper Palaeolithic dated-remains evidence.

The source publishes uncalibrated radiocarbon BP ages and a reported range. For
a timeline position only, BP is counted back from 1950 CE; the generated catalog
retains both source values and does not call that display range a calibrated date.
"""
import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/paleohumans-remains.json'
CACHE = Path('/tmp/human-atlas-research/paleohumans-dataset.zip')
URL = 'https://api.paleohumans.org/api/dataset/download'
SHA256 = 'ea528877d0c04505619020069c96f7a64770c0e2cc0523a7b5822dcfa82092ea'


def source_bytes():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'Human Atlas data preparation'})
        with urllib.request.urlopen(request, timeout=120) as response:
            CACHE.write_bytes(response.read())
    data = CACHE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise ValueError(f'PaleoHumans export checksum changed: {digest}')
    return data


def csv_rows(archive, name):
    return list(csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8', newline='')))


def number(value):
    if not value or not value.strip():
        return None
    result = float(value)
    return int(result) if result.is_integer() else result


def main():
    with zipfile.ZipFile(io.BytesIO(source_bytes())) as archive:
        metadata = {row['key']: row['value'] for row in csv_rows(archive, 'metadata.csv')}
        sites = {row['site_id']: row for row in csv_rows(archive, 'sites.csv')}
        contexts = {row['archaeological_context_id']: row for row in csv_rows(archive, 'archaeological_contexts.csv')}
        cultures = {row['culture_id']: row for row in csv_rows(archive, 'cultures.csv')}
        samples = {row['dated_sample_id']: row for row in csv_rows(archive, 'dated_samples.csv')}
        results = csv_rows(archive, 'dating_results.csv')
    records = []
    for result in results:
        sample = samples.get(result['dated_sample_id'])
        context = contexts.get(sample['archaeological_context_id']) if sample else None
        site = sites.get(context['site_id']) if context else None
        age, range_value = number(result['dates_bp_uncal']), number(result['dates_range'])
        if not (site and age is not None and range_value is not None and site['latitude'] and site['longitude']):
            continue
        culture = cultures.get(context['culture_id'])
        # The oldest possible source age maps to the lower calendar-axis value.
        display_range = [1950 - (age + range_value), 1950 - (age - range_value)]
        records.append({
            'id': f"paleohumans-{result['dating_result_id']}",
            'siteId': site['site_id'], 'site': site['site_name'], 'country': site['country'],
            'region': site['region'], 'municipality': site['municipality'],
            'lat': round(float(site['latitude']), 6), 'lon': round(float(site['longitude']), 6),
            'contextId': context['archaeological_context_id'], 'stratigraphicContext': context['stratigraphic_context'],
            'culture': culture['culture_name'] if culture else None,
            'culturePhase': culture['phase'] if culture else None,
            'cultureRangeBP': [number(culture['start_bp']), number(culture['end_bp'])] if culture else None,
            'sampleId': sample['dated_sample_id'], 'material': sample['material'], 'datingType': sample['dating_type'],
            'radiocarbonBP': age, 'radiocarbonRange': range_value,
            'displayRange': display_range,
        })
    if len(records) != 134:
        raise ValueError(f'Expected 134 fully linked dated records, found {len(records)}')
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('PaleoHumans dating-result IDs are not unique')
    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'PaleoHumans Dataset', 'version': metadata.get('schema_model_version'),
            'authors': 'Arenas del Amo, Armentano Oller, Daura and Sanz (2024)',
            'paper': 'https://doi.org/10.1016/j.jasrep.2024.104391',
            'url': URL, 'sha256': SHA256, 'license': metadata.get('license', 'CC BY 4.0'),
            'interpretation': 'One record is one published uncalibrated radiocarbon dating result linked through the exported relational tables to an archaeological context and geocoded site. displayRange is only a BP-to-1950 CE placement for the atlas timeline, calculated as 1950 − (BP ± published dates_range); it is not a calibrated calendar interval. A point documents dated human-remains evidence at a site, not continuous occupation, a culture boundary, ancestry, language, or population.',
        },
        'records': records,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'PaleoHumans: {len(records)} fully linked uncalibrated radiocarbon records; {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()