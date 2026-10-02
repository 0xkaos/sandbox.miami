#!/usr/bin/env python3
"""Build a compact western ancient-places layer from Pleiades release 4.1.

Pleiades is a gazetteer, not a catalog of excavations. Its location-year bounds
indicate broad temporal associations and must not be treated as a claim of
continuous site occupation. The source release and every CSV are pinned and
checksum-verified. All processing uses the Python standard library.
"""

import csv
import hashlib
import io
import json
import math
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/pleiades-places.json'
CACHE = Path('/tmp/human-atlas-source')
REVISION = 'b6a6790f71c45e4a4ef60fce296c506f28f458bf'  # release v4.1
BASE = f'https://raw.githubusercontent.com/isawnyu/pleiades.datasets/{REVISION}/data/gis'
SHA256 = {
    'places.csv': '5dd09b1a92c53e50cb9962bab44df12c5f0b7b683d4f228367d843637cfe5a59',
    'places_place_types.csv': '846acc52098771ead0ee673bf92e8304906389fc681c1750107f28d584e09d24',
    'place_types.csv': 'bfa08923af4ef739d5c54de7ce7434f87d332837b841fd6661a3e99272fc077b',
    'location_points.csv': '20edc5ef9748354fe917a17ba949a17c7af8cc593e07522926924eada64d080d',
    'location_linestrings.csv': 'a7eee64abdccfb6167dc4c3146b40ed22802bcf6150888fd9b7bee722bfda9ae',
    'location_polygons.csv': '4946c2e5be47797c5e80dffba66c26e40fd2be94e4677c770d1f82ddac124452',
    'names.csv': '04716712d78dce2b43c9d093ba908d8397ee17496ffec8644e84a4bad1dac02d',
}

# Include settlements, archaeological sites, and named built/funerary features.
# Do not map people, regions, rivers, roads or modern settlements as site points.
SITE_TYPES = {
    'settlement', 'fortified-settlement', 'archaeological-site', 'cemetery',
    'tomb', 'findspot', 'tumulus', 'hillfort', 'fort', 'fort-2', 'temple',
    'temple-2', 'sanctuary', 'port', 'villa', 'station', 'palace',
    'palace-complex', 'quarry', 'mine', 'mine-2', 'church', 'church-2',
}
BOUNDS = [-21, 10, 79, 72]  # western Europe/North Africa through the Indus region

# Row columns: id, title, lat, lon, precision (1 precise/0 rough), kind index,
# all source type indexes, description, provenance index, maximum location
# accuracy radius m, spread of the source bounding box km, archaeological-
# remains indexes, distinct temporal-association indexes (location dates or
# dated names as a fallback), certain source name aliases for search.
COLUMNS = ['id', 'title', 'lat', 'lon', 'precision', 'kind', 'types',
           'description', 'provenance', 'accuracyRadiusMeters',
           'locationSpreadKm', 'archaeologicalRemains', 'temporalAssociations',
           'nameAliases']


def read_csv(name):
    path = CACHE / f'pleiades-v4.1-{name}'
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(f'{BASE}/{name}', headers={'User-Agent': 'Human Atlas data preparation'})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256[name]:
        raise ValueError(f'Pleiades {name} checksum changed: {digest}')
    return list(csv.DictReader(io.StringIO(data.decode('utf-8-sig'))))


def spread_km(wkt, latitude):
    coordinates = [float(value) for value in re.findall(r'-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?', wkt)]
    if len(coordinates) < 4:
        return None
    longitudes, latitudes = coordinates[0::2], coordinates[1::2]
    east_west = (max(longitudes) - min(longitudes)) * 111.2 * math.cos(math.radians(latitude))
    north_south = (max(latitudes) - min(latitudes)) * 111.2
    return round(math.hypot(east_west, north_south), 1)


def main():
    places = read_csv('places.csv')
    types = defaultdict(set)
    for row in read_csv('places_place_types.csv'):
        types[row['place_id']].add(row['place_type'])
    type_vocabulary = {row['key']: row['term'] for row in read_csv('place_types.csv')}

    temporal = defaultdict(set)
    accuracy = defaultdict(list)
    remains = defaultdict(set)
    for filename in ('location_points.csv', 'location_linestrings.csv', 'location_polygons.csv'):
        for row in read_csv(filename):
            place_id = row['place_id']
            if row['year_after_which'] and row['year_before_which']:
                start, end = int(row['year_after_which']), int(row['year_before_which'])
                if start <= end:
                    # This certainty concerns the *association of a location*
                    # with a Pleiades place, not the precision of its date.
                    temporal[place_id].add((start, end, row['association_certainty'], 0, ''))
            if row['accuracy_radius']:
                accuracy[place_id].append(float(row['accuracy_radius']))
            if row['archaeological_remains'] and row['archaeological_remains'] != 'unknown':
                remains[place_id].add(row['archaeological_remains'])

    name_temporal = defaultdict(set)
    name_aliases = defaultdict(set)
    for row in read_csv('names.csv'):
        if row['association_certainty'] == 'certain':
            for field in ('title', 'attested_form', 'romanized_form_1',
                          'romanized_form_2', 'romanized_form_3'):
                alias = row[field].strip()
                if alias:
                    name_aliases[row['place_id']].add(alias)
        if row['year_after_which'] and row['year_before_which']:
            start, end = int(row['year_after_which']), int(row['year_before_which'])
            if start <= end:
                name_temporal[row['place_id']].add((start, end, row['association_certainty'], 1, row['title'].strip()))

    provenance = ['']
    provenance_index = {'': 0}
    type_codes = []
    type_index = {}
    remains_codes = []
    remains_index = {}
    certainty_codes = []
    certainty_index = {}
    intervals = []
    interval_index = {}
    kinds = ['settlement', 'archaeological site', 'built or funerary site']

    def intern(values, index, key):
        if key not in index:
            index[key] = len(values)
            values.append(key)
        return index[key]

    output = []
    for place in places:
        try:
            lat, lon = float(place['representative_latitude']), float(place['representative_longitude'])
        except (ValueError, TypeError):
            continue
        if not (BOUNDS[0] <= lon <= BOUNDS[2] and BOUNDS[1] <= lat <= BOUNDS[3]):
            continue
        place_types = types[place['id']]
        selected_types = place_types & SITE_TYPES
        associations = temporal[place['id']] or name_temporal[place['id']]
        if not selected_types or not associations:
            continue
        if 'settlement' in selected_types or 'fortified-settlement' in selected_types:
            kind = 0
        elif 'archaeological-site' in selected_types:
            kind = 1
        else:
            kind = 2
        accuracy_m = max(accuracy[place['id']]) if accuracy[place['id']] else None
        output.append([
            place['id'], place['title'], round(lat, 6), round(lon, 6),
            1 if place['location_precision'] == 'precise' else 0, kind,
            [intern(type_codes, type_index, code) for code in sorted(place_types)],
            place['description'].strip(),
            intern(provenance, provenance_index, place['provenance'].strip()),
            round(accuracy_m, 1) if accuracy_m is not None else None,
            spread_km(place['bounding_box_wkt'], lat),
            [intern(remains_codes, remains_index, code) for code in sorted(remains[place['id']])],
            [intern(intervals, interval_index, (start, end, intern(certainty_codes, certainty_index, certainty), basis, name))
             for start, end, certainty, basis, name in sorted(associations)],
            sorted((name for name in name_aliases[place['id']] if name != place['title']),
                   key=lambda name: (name.casefold(), name)),
        ])

    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'Pleiades gazetteer of ancient places',
            'release': '4.1 (28 May 2025)', 'revision': REVISION,
            'releaseUrl': 'https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1',
            'downloadPage': 'https://pleiades.stoa.org/downloads',
            'baseUrl': BASE, 'fileSha256': SHA256, 'license': 'CC BY 3.0',
            'coverage': 'Selected geocoded settlements, archaeological sites and built/funerary places in western Eurasia and northern Africa; bounds west -21°, south 10°, east 79°, north 72°.',
            'aliasPolicy': 'Search aliases are verbatim title, attested-form, and romanized-form fields from Name records with a certain association to the source place. They are lookup terms only, not evidence that a name was used at the queried year.',
            'interpretation': 'A Pleiades place is a gazetteer entry, not necessarily an excavated archaeological site or a list of finds. Dates come from Location records, or dated Name records only where locations have no dates. year_after_which and year_before_which are terminus bounds, often broad periods, not continuous settlement occupation; a dated name only associates a name with the place in that period. Archaeological-remains statuses are pooled across a place’s Location records, not assigned to the queried year or a specific find. Representative coordinates and source accuracy radii can be uncertain; rough representative points may be bounding-box centroids.',
        },
        'columns': COLUMNS,
        'dictionary': {
            'kinds': kinds,
            'types': [{'code': code, 'label': type_vocabulary.get(code, code)} for code in type_codes],
            'provenance': provenance,
            'archaeologicalRemains': remains_codes,
            'associationCertainty': certainty_codes,
            'temporalBasis': ['location', 'name'],
            'temporalAssociations': [list(pair) for pair in intervals],
        },
        'places': output,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(output):,} selected Pleiades ancient place records; '
          f'{sum(row[4] == 1 for row in output):,} precise-classed, '
          f'{sum(row[4] == 0 for row in output):,} rough-classed, '
          f'{sum(intervals[i][3] == 1 for row in output for i in row[12]):,} name-fallback associations')
    print(f'{OUT}: {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
