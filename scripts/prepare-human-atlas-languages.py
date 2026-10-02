#!/usr/bin/env python3
"""Build a compact modern language reference from pinned Glottolog 5.3 CLDF.

Only spoken-L1 language records with a representative point and a published
non-extinct AES category are selected. The result is a catalog reference, not
a time series, a speaker-density map, or a reconstruction of family homelands.
"""

import csv
import hashlib
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/languages.json'
CACHE = Path('/tmp/human-atlas-source/glottolog-cldf-v5.3')
REVISION = '072ca0d0410039fb8b779be8fc165bac575d2cda'
RELEASE = 'https://github.com/glottolog/glottolog-cldf/releases/tag/v5.3'
BASE = f'https://raw.githubusercontent.com/glottolog/glottolog-cldf/{REVISION}/cldf/'
FILES = {
    'languages.csv': '1a50a393bc81568b656f9522be18aa4f80f38e94309ba6c863d583234adfbb89',
    'values.csv': 'a8601cb04ccc6a310538217f772d2461853aa0ea49e3bfe24c7396570fc4ea25',
}
ACTIVE_AES = {
    'aes-not_endangered': 'not endangered',
    'aes-threatened': 'threatened',
    'aes-shifting': 'shifting',
    'aes-moribund': 'moribund',
    'aes-nearly_extinct': 'nearly extinct',
}


def source_file(name):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if not path.exists():
        request = urllib.request.Request(BASE + name, headers={'User-Agent': 'Human Atlas source preparation'})
        partial = path.with_suffix(path.suffix + '.part')
        try:
            with urllib.request.urlopen(request, timeout=120) as response, partial.open('wb') as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != FILES[name]:
        raise ValueError(f'{name} checksum changed: expected {FILES[name]}, got {digest}')
    return path


def rows(path):
    with path.open(newline='', encoding='utf-8') as source:
        yield from csv.DictReader(source)


def main():
    paths = {name: source_file(name) for name in FILES}
    languoids = {row['ID']: row for row in rows(paths['languages.csv'])}
    categories, aes, classifications = {}, {}, {}
    for row in rows(paths['values.csv']):
        parameter = row['Parameter_ID']
        if parameter == 'category':
            categories[row['Language_ID']] = row['Value']
        elif parameter == 'aes':
            aes[row['Language_ID']] = row['Code_ID']
        elif parameter == 'classification':
            classifications[row['Language_ID']] = row['Value'].split('/')

    languages, needed_groups = [], set()
    for row in languoids.values():
        lang_id = row['ID']
        if (row['Level'] != 'language' or categories.get(lang_id) != 'Spoken_L1_Language'
                or aes.get(lang_id) not in ACTIVE_AES or not row['Latitude'] or not row['Longitude']):
            continue
        ancestors = classifications.get(lang_id, [])
        is_isolate = row['Is_Isolate'].lower() == 'true'
        family_id = row['Family_ID'] or (lang_id if is_isolate else None)
        if not family_id or family_id not in languoids:
            raise ValueError(f'No genealogical root for {lang_id}')
        if row['Family_ID'] and (not ancestors or ancestors[0] != family_id):
            raise ValueError(f'Incomplete classification path for {lang_id}')
        needed_groups.update(ancestors if ancestors else [family_id])
        languages.append({
            'id': lang_id,
            'name': row['Name'],
            'lat': round(float(row['Latitude']), 4),
            'lon': round(float(row['Longitude']), 4),
            'familyId': family_id,
            'familyName': languoids[family_id]['Name'],
            'parentId': ancestors[-1] if ancestors else None,
            'iso639P3code': row['ISO639P3code'] or None,
            'aesStatus': ACTIVE_AES[aes[lang_id]],
        })

    # Store the intermediate family nodes so the atlas can distinguish, for
    # example, Germanic from its Indo-European root. Family coordinates from
    # Glottolog are deliberately omitted: they are computed centroids, not
    # historical homelands or present-day range centers.
    groups = []
    for group_id in needed_groups:
        row = languoids[group_id]
        isolate = row['Level'] == 'language' and row['Is_Isolate'].lower() == 'true'
        group_category = categories.get(group_id)
        if not isolate and (row['Level'] != 'family' or group_category not in ('Family', 'Pseudo_Family')):
            raise ValueError(f'Unexpected non-genealogical group {group_id}')
        ancestors = classifications.get(group_id, [])
        root_id = row['Family_ID'] or group_id
        groups.append({
            'id': group_id,
            'name': row['Name'],
            'parentId': ancestors[-1] if ancestors else None,
            'rootId': root_id,
            'kind': 'isolate' if isolate else ('unclassified-group' if group_category == 'Pseudo_Family' else 'family'),
        })

    if len(languages) != 6683:
        raise ValueError(f'Unexpected Glottolog 5.3 selection: {len(languages)} languages')
    result = {
        'schemaVersion': 1,
        'referenceYear': 2017,
        'status': ('Glottolog 5.3 (2026) present-day reference displayed only at the atlas 2017 endpoint. '
                   'Points are representative, may indicate historical locations, and are not speaker ranges, '
                   'population estimates, family homelands, or a 2017 census.'),
        'source': {
            'dataset': 'Glottolog 5.3 CLDF',
            'revision': REVISION,
            'release': RELEASE,
            'license': 'CC BY 4.0',
            'citation': ('Hammarström, Harald; Forkel, Robert; Haspelmath, Martin; Bank, Sebastian. '
                         '2026. Glottolog 5.3. Leipzig: Max Planck Institute for Evolutionary Anthropology.'),
            'files': {name: {'url': BASE + name, 'sha256': digest} for name, digest in FILES.items()},
            'selection': ('Spoken L1 language-level records with coordinates and AES category not endangered, '
                          'threatened, shifting, moribund, or nearly extinct; extinct and uncategorized records excluded.'),
            'pointCaveat': 'Glottolog coordinates are representative and variably present-day or historical.',
            'familyCaveat': 'Genealogical classifications are separate from archaeology, genes, and political borders.',
        },
        'groups': sorted(groups, key=lambda row: row['id']),
        'languages': sorted(languages, key=lambda row: row['id']),
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(languages):,} language points and {len(groups):,} family/isolate nodes → {OUT} ({OUT.stat().st_size:,} bytes)')
    for name, digest in FILES.items():
        print(f'{name} SHA-256 {digest}')


if __name__ == '__main__':
    main()
