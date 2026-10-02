#!/usr/bin/env python3
"""Build compact European people areas and undated EUROEVOL site associations.

Requires Shapely. Source files are pinned by revision or checksum and cached
outside the repository. EUROEVOL phase codes have no calibrated calendar dates:
this script intentionally does not place those sites on the time slider.
"""

import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import Point, mapping, shape


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/threejs/human_atlas/data'
CACHE = Path('/tmp/human-atlas-source')

CLIO_REVISION = 'ad28a691b7c07c1fca89d0e0636d324667d2a258'
CLIO_URL = f'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/{CLIO_REVISION}/cliopatria.geojson.zip'
CLIO_SHA256 = 'd01ae3a20d358cc5d54f69d9d725d390767d9c8759ac89ad6f90c58d106f3370'
PLEIADES_REVISION = '0ba82f79f123bfea75d4c70a748a115fdd7ca703'
PLEIADES_BASE = f'https://raw.githubusercontent.com/isawnyu/pleiades.datasets/{PLEIADES_REVISION}/data/gis/'
EUROEVOL_BASE = 'https://discovery.ucl.ac.uk/id/eprint/1469811/'

SOURCES = {
    'cliopatria.geojson.zip': (CLIO_URL, CLIO_SHA256),
    'pleiades-places.csv': (PLEIADES_BASE + 'places.csv', 'bb3b2594ca9fbf46349a037af6ed9458db12e355e761477c51588c6248897bbb'),
    'pleiades-names.csv': (PLEIADES_BASE + 'names.csv', '413a3def4df190054b2d470946a887605b915e76eb8c21cdcea430fab0c6858d'),
    'pleiades-place-types.csv': (PLEIADES_BASE + 'places_place_types.csv', '8d27fdd1d3a947299d3cb21f563f7dea1c4fd93b5a5140338f89e72a4a5959e2'),
    'euroevol-common-sites.csv': (EUROEVOL_BASE + '9/EUROEVOL09-07-201516-34_CommonSites.csv', '25fa9ce0915146a00b0957dfda897770758aa7ceb32b81932a252c9b5c20a0f5'),
    'euroevol-common-phases.csv': (EUROEVOL_BASE + '8/EUROEVOL09-07-201516-34_CommonPhases.csv', '40245b1319b9df3b339042ae5b8b8905533d810af74e39d76f76f31cc33cda96'),
}

# Cliopatria calls all of these POLITY. An ethnonym or moving people is kept
# separate from a successor kingdom in this atlas. These source shapes are
# associated areas, not surveyed tribal borders.
PEOPLES = {
    'Goths': ('#a2a77c', 154, 206),
    'Gothia': ('#a2a77c', 207, 382),
    'Burgundians': ('#bc9374', 154, 409),
    'Saxons': ('#81a8a6', 283, 799),
    'Angles': ('#8fb4a7', 387, 479),
    'Salian Franks': ('#b7a37a', 358, 509),
    'Ripuarian Franks': ('#aa9874', 238, 509),
    'Vandals': ('#a398ad', 337, 406),
    'Visigoths': ('#b48c9b', 396, 425),
    'Ostrogoths': ('#8e9fba', 455, 499),
    'Lombards': ('#aeb487', 480, 586),
}
KINGDOMS = {
    'Kingdom of the Suebi': ('#ac9877', 414, 586),
    'Burgundian Kingdom': ('#bc9374', 414, 533),
    'Vandal Kingdom': ('#a398ad', 439, 533),
    'Visigothic Kingdom': ('#b48c9b', 426, 723),
    'Ostrogothic Kingdom': ('#8e9fba', 500, 560),
    'Kingdom of Alamannia': ('#8da694', 462, 499),
    'Kingdom of Thuringia': ('#9bab9a', 476, 533),
    'Kingdom of the Gepids': ('#b29baf', 510, 566),
    'Magna Frisia': ('#79a5ac', 602, 771),
}
TRIBE_LABEL_IDS = {
    '99040',    # Suebi
    '98929',    # Bructeri
    '98939',    # Cherusci
    '98962',    # Frisii
    '98937',    # Chauci
    '109371',   # Tencteri
    '108885',   # Chatti
    '118962',   # Semnones
    '118831',   # Marcomanni
    '128501',   # Quadi
}

# A stable point near Carthage, within every retained Vandal Kingdom shape.
# Shapely's representative point for a multipart map can otherwise land on
# Sicily or Sardinia even when the polity's main historical context is Africa.
FOCUS_POINTS = {'Vandal Kingdom': (9.8, 36.7)}


def source_file(name):
    url, expected = SOURCES[name]
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={'User-Agent': 'Human Atlas source preparation'})
        with urllib.request.urlopen(request, timeout=120) as response, path.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f'{name}: expected SHA-256 {expected}, got {actual}')
    return path


def read_csv(name):
    with source_file(name).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def round_coords(value):
    if isinstance(value, (tuple, list)):
        return [round_coords(part) for part in value]
    return round(value, 3)


def geometry(feature):
    compact = shape(feature).simplify(.035, preserve_topology=True)
    return {'type': compact.geom_type, 'coordinates': round_coords(mapping(compact)['coordinates'])}, compact


def euroevol_catalog():
    sites = read_csv('euroevol-common-sites.csv')
    phases = read_csv('euroevol-common-phases.csv')
    phases_by_site = defaultdict(list)
    culture_counts = Counter()
    for row in phases:
        clean = lambda key: None if row[key] in ('', 'NULL') else row[key]
        phase = {
            'id': row['PhaseCode'],
            'culture': clean('Culture'),
            'subculture': clean('Subculture'),
            'periodCode': clean('Period'),
            'siteType': clean('Type'),
        }
        phases_by_site[row['SiteID']].append(phase)
        if phase['culture']:
            culture_counts[phase['culture']] += 1
    records = []
    for row in sites:
        site_id = row['SiteID']
        records.append({
            'id': f'euroevol-{site_id}', 'sourceSiteID': site_id, 'collection': 'euroevol',
            'name': row['SiteName'], 'country': row['Country'],
            'lat': round(float(row['Latitude']), 4), 'lon': round(float(row['Longitude']), 4),
            'temporalStatus': 'undated-phase-association',
            'phases': phases_by_site.pop(site_id, []),
        })
    # One published phase (S8825 / LOUS) has no CommonSites coordinate. Keep a
    # count for audit, but do not invent a mapped position for that record.
    unlocated_phases = sum(len(group) for group in phases_by_site.values())
    return {
        'schemaVersion': 1,
        'source': {
            'dataset': 'The Cultural Evolution of Neolithic Europe (EUROEVOL), Manning et al. 2015',
            'url': EUROEVOL_BASE, 'license': 'CC0 1.0',
            'tables': {name: {'url': SOURCES[name][0], 'sha256': SOURCES[name][1]} for name in ('euroevol-common-sites.csv', 'euroevol-common-phases.csv')},
            'dateStatus': 'CommonPhases contains cultural assignments and broad period codes, but no calibrated calendar-year phase ranges. None are mapped to the time slider.',
            'locationStatus': 'Published site coordinates have variable precision; no new geocoding is inferred here.',
            'cultureStatus': 'Culture and Subculture are the source assignments, including some broad period-like labels. They are searchable evidence, not uniform taxonomic classes.',
        },
        'counts': {
            'sites': len(records), 'phaseRows': len(phases), 'unlocatedPhaseRows': unlocated_phases,
            'sitesWithPhase': sum(bool(site['phases']) for site in records),
            'sitesWithNamedCulture': sum(any(p['culture'] for p in site['phases']) for site in records),
            'cultureAssignments': dict(sorted(culture_counts.items())),
        },
        'sites': records,
    }


def european_peoples_catalog():
    with zipfile.ZipFile(source_file('cliopatria.geojson.zip')) as archive:
        source = json.load(archive.open('cliopatria_polities_only.geojson'))['features']
    features = []
    skipped_flash = {'Visigothic Kingdom': {458}, 'Saxons': {775}}
    for item in source:
        props = item['properties']
        name = props['Name']
        spec = PEOPLES.get(name) or KINGDOMS.get(name)
        if props['Type'] != 'POLITY' or not spec:
            continue
        color, min_year, max_year = spec
        original_start, original_end = props['FromYear'], props['ToYear']
        if original_end < min_year or original_start > max_year or original_start in skipped_flash.get(name, ()):
            continue
        # A two/three-year isolated shape change would appear as a distracting
        # flash. Hold the previous source reconstruction over the gap and
        # preserve its original interval for review.
        start, end = max(original_start, min_year), min(original_end, max_year)
        if name == 'Visigothic Kingdom' and original_start == 455:
            end = 458
        if name == 'Saxons' and original_start == 772:
            end = 777
        geom_json, geom = geometry(item['geometry'])
        if geom.is_empty:
            raise ValueError(f'Empty source geometry: {name} {original_start}')
        components = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
        component_centers = [[round(part.representative_point().x, 4), round(part.representative_point().y, 4)]
                             for part in components]
        if name in FOCUS_POINTS:
            center = Point(FOCUS_POINTS[name])
            if not geom.covers(center):
                raise ValueError(f'Reviewed focus lies outside {name} {original_start}')
        else:
            # Focus the largest connected area of a multipart reconstruction.
            center = max(components, key=lambda part: part.area).representative_point()
        kind = 'people' if name in PEOPLES else 'polity'
        note = (
            'Associated area of a named people in this source reconstruction. This was not a unified state or an exact ethnic boundary.'
            if kind == 'people' else
            'Approximate territory of a named kingdom or polity in this source interval. Direct rule and influence need not coincide with the drawn edge.'
        )
        if name == 'Gothia':
            note = 'Broad source reconstruction of areas associated with Gothic groups. Gothic identities and political units were diverse; this is not one surveyed frontier.'
        if name == 'Magna Frisia':
            note = 'Approximate Frisian political area. The alternate Cliopatria “Frisia Kingdom” rows were excluded because their geometries fall far south of Frisia.'
        features.append({
            'id': f'europe-{name.lower().replace(" ", "-")}-{original_start}',
            'name': name, 'kind': kind, 'collection': 'european', 'start': start, 'end': end,
            'sourceInterval': [original_start, original_end],
            'lat': round(center.y, 3), 'lon': round(center.x, 3),
            'componentCenters': component_centers,
            'color': color, 'area': round(props['Area'], 1),
            'confidence': 'approximate' if kind == 'polity' else 'schematic',
            'note': note,
            'sources': ['cliopatria'],
            'wikidata': props['Wikidata'] or None,
            'geometry': geom_json,
        })
    places = {row['id']: row for row in read_csv('pleiades-places.csv') if row['id'] in TRIBE_LABEL_IDS}
    types = defaultdict(set)
    for row in read_csv('pleiades-place-types.csv'):
        if row['place_id'] in TRIBE_LABEL_IDS:
            types[row['place_id']].add(row['place_type'])
    name_ranges = defaultdict(list)
    for row in read_csv('pleiades-names.csv'):
        if row['place_id'] in TRIBE_LABEL_IDS and row['year_after_which'] and row['year_before_which']:
            name_ranges[row['place_id']].append((int(row['year_after_which']), int(row['year_before_which'])))
    if set(places) != TRIBE_LABEL_IDS or any('people' not in types[id] or not name_ranges[id] for id in TRIBE_LABEL_IDS):
        raise ValueError('A reviewed Pleiades ethnonym record or name-period is missing')
    labels = []
    for id in sorted(TRIBE_LABEL_IDS, key=lambda id: places[id]['title']):
        row = places[id]
        source_start = min(a for a, _ in name_ranges[id])
        source_end = max(b for _, b in name_ranges[id])
        # Roman-era reference window: broad scholarly period terms are not
        # exact years of founding, migration, or extinction.
        start, end = max(-100, source_start), min(300, source_end)
        labels.append({
            'id': f'pleiades-{id}', 'name': row['title'], 'kind': 'ethnonym', 'collection': 'european',
            'start': start, 'end': end, 'namePeriod': [source_start, source_end],
            'lat': round(float(row['representative_latitude']), 4),
            'lon': round(float(row['representative_longitude']), 4),
            'confidence': 'representative label point',
            'note': 'A Pleiades label for a named people. Its point gives an approximate geographic reference, not a tribal capital or territorial boundary. The date range is a broad name-period viewing window, not an existence span.',
            'url': row['uri'], 'sources': ['pleiades'],
        })
    return {
        'schemaVersion': 1,
        'bounds': [-11, 29, 41, 62],
        'source': {
            'polygons': {'dataset': 'Cliopatria / Seshat', 'revision': CLIO_REVISION, 'url': CLIO_URL, 'sha256': CLIO_SHA256, 'license': 'CC BY 4.0'},
            'labels': {'dataset': 'Pleiades GIS', 'revision': PLEIADES_REVISION, 'license': 'CC BY 3.0',
                       'tables': {name: {'url': SOURCES[name][0], 'sha256': SOURCES[name][1]} for name in ('pleiades-places.csv', 'pleiades-names.csv', 'pleiades-place-types.csv')}},
            'interpretation': 'Cliopatria POLITY rows for named peoples are categorized here as people, not states. All extents are approximate; Pleiades ethnonyms use representative points and broad name periods.',
            'excluded': [
                'Cliopatria Frisia Kingdom geometries (far south of Frisia)',
                'Cimbri Pleiades representative point (near a migration route rather than a homeland)',
                'Goths before 154 CE (a proposed Scandinavian origin rather than a well-located historic polity)',
                'Vandals 407–438 CE (a migration itinerary is better shown as dated waypoints than filled territory)',
                'Transient Visigothic Kingdom 458 and Saxons 775–777 geometries (previous shape held across these flashes)',
            ],
        },
        'features': sorted(features, key=lambda feature: (feature['start'], feature['name'])),
        'places': labels,
    }


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    euroevol = euroevol_catalog()
    peoples = european_peoples_catalog()
    for name, catalog in [('euroevol-sites.json', euroevol), ('european-peoples.json', peoples)]:
        path = DATA / name
        path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')))
        print(f'{name}: {path.stat().st_size:,} bytes')
    print(f"EUROEVOL: {euroevol['counts']['sites']} sites, {euroevol['counts']['phaseRows']} undated phases")
    print(f"European peoples: {len(peoples['features'])} dated shapes, {len(peoples['places'])} ethnonym labels")


if __name__ == '__main__':
    main()
