#!/usr/bin/env python3
"""Build the reviewed Near East overlay from a pinned Cliopatria release.

Requires shapely. The source archive is cached outside the repository because
the bundled output contains only the small, selected regional geometries.
"""

import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/near-east.json'
CACHE = Path('/tmp/human-atlas-source/cliopatria.geojson.zip')
REVISION = 'ad28a691b7c07c1fca89d0e0636d324667d2a258'
URL = f'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/{REVISION}/cliopatria.geojson.zip'
SHA256 = 'd01ae3a20d358cc5d54f69d9d725d390767d9c8759ac89ad6f90c58d106f3370'


def rounded(value):
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    return round(value, 3)


def geometry(geom):
    simplified = geom.simplify(.035, preserve_topology=True)
    return {'type': simplified.geom_type, 'coordinates': rounded(mapping(simplified)['coordinates'])}


def record(id, name, kind, start, end, geom, color, note, sources, confidence='approximate'):
    center = geom.representative_point()
    return {'id': id, 'name': name, 'kind': kind, 'start': start, 'end': end,
            'lat': round(center.y, 3), 'lon': round(center.x, 3),
            'color': color, 'area': round(geom.area, 3), 'note': note, 'sources': sources,
            'confidence': confidence, 'geometry': geometry(geom)}


def main():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'Human Atlas source preparation'})
        with urllib.request.urlopen(request, timeout=120) as response, CACHE.open('wb') as output:
            while block := response.read(1024 * 1024):
                output.write(block)
    digest = hashlib.sha256(CACHE.read_bytes()).hexdigest()
    if digest != SHA256:
        raise ValueError(f'Cliopatria archive checksum changed: {digest}')
    with zipfile.ZipFile(CACHE) as archive, archive.open('cliopatria_polities_only.geojson') as raw:
        source = json.load(raw)['features']
    selected = []
    first_sumer = []
    last_judah = None
    names = {
        'Sumerian City-States': ('Sumerian city-states', '#c4a364', 'Political centers and competing city-states in southern Mesopotamia; the named area is not one unified kingdom.', ['cliopatria', 'met-akkad']),
        'Akkadian Empire': ('Akkadian Empire', '#b77563', 'Approximate extent of Akkadian rule. Campaigns and influence did not imply uniform administration across this entire area.', ['cliopatria', 'met-akkad']),
        'Assyria': ('Assyria', '#a97858', 'Assyrian polity or heartland in this source interval. Its reach changed greatly across Old, Middle, and Neo-Assyrian periods.', ['cliopatria', 'met-assyria']),
        'Neo-Assyrian Empire': ('Neo-Assyrian Empire', '#a97858', 'Approximate imperial extent. Direct provinces, tributary kingdoms, and military campaigns were different relationships.', ['cliopatria', 'met-assyria', 'oracc-israel']),
        'Babylonia': ('Babylonia', '#a68b72', 'A reconstructed Babylonian polity or core area for the source interval.', ['cliopatria', 'met-isin']),
        'Neo-Babylonian Empire': ('Neo-Babylonian Empire', '#a68b72', 'Approximate imperial extent after Assyria. The first and last source shapes are held to the historically dated transitions.', ['cliopatria', 'met-isin', 'met-israel']),
        'Kingdom of Israel': ('Kingdom of Israel', '#83a587', 'Northern kingdom, with Samaria as its capital. The display ends at the fall of Samaria, correcting the source dataset’s later end date.', ['cliopatria', 'met-israel', 'oracc-israel']),
        'Kingdom of Judah': ('Kingdom of Judah', '#90a8ac', 'Southern kingdom centered on Jerusalem. These source polygons end in 701 BCE; later continuity is shown separately and schematically.', ['cliopatria', 'met-israel']),
        'Mitanni': ('Mitanni', '#9984a8', 'Approximate northern Syrian and Mesopotamian polity; regional influence changed during the Late Bronze Age.', ['cliopatria', 'met-canaan']),
    }
    for item in source:
        props = item['properties']
        name = props['Name']
        if name not in names or props['Type'] != 'POLITY':
            continue
        start, end = props['FromYear'], props['ToYear']
        if name == 'Sumerian City-States' and (start < -3000 or start > -2301):
            continue
        if name == 'Assyria' and (start < -1800 or start > -901):
            continue
        if name == 'Babylonia' and (start < -1800 or start > -601):
            continue
        geom = shape(item['geometry'])
        if name == 'Sumerian City-States' and start in (-3000, -2700):
            first_sumer.append(geom)
        if name == 'Kingdom of Judah' and start == -750:
            last_judah = geom
        if name == 'Akkadian Empire':
            if start == -2300: start = -2350
            if end == -2101: end = -2150
        if name == 'Kingdom of Israel':
            end = min(end, -723)
            if end < start: continue
        if name == 'Neo-Assyrian Empire':
            end = min(end, -609)
            if end < start: continue
        if name == 'Neo-Babylonian Empire':
            if start == -600: start = -626
            end = min(end, -539)
            if end < start: continue
        if name == 'Mitanni' and start == -1500:
            start = -1600
        label, color, note, sources = names[name]
        entry = record(f'{name.lower().replace(" ", "-")}-{props["FromYear"]}', label, 'polity', start, end, geom, color, note, sources)
        entry['sourceInterval'] = [props['FromYear'], props['ToYear']]
        selected.append(entry)

    # These are transparent regional context areas or explicitly schematic
    # cores. Their boundaries are editorial visualizations, not excavated lines.
    sumer = unary_union(first_sumer)
    selected.append(record('sumer-region', 'Sumer · cultural region', 'culture', -3400, -1800, sumer, '#c4a364',
                           'Illustrative envelope of early southern Mesopotamian city-state footprints. Sumer was a region and cultural tradition; its cities had changing rulers.', ['cliopatria', 'met-akkad'], 'schematic'))
    ur_core = shape({'type': 'Polygon', 'coordinates': [[[43.2, 33.4], [44.1, 34.2], [46.0, 33.6], [47.9, 32.3], [48.3, 30.2], [46.7, 29.9], [44.6, 30.5], [43.5, 31.8], [43.2, 33.4]]]})
    selected.append(record('ur-iii-core', 'Ur III state · approximate core', 'polity', -2112, -2004, ur_core, '#d1ad68',
                           'Schematic southern Mesopotamian core of the Ur III state, centered on the city of Ur. This outline is not a reconstructed state boundary.', ['met-isin', 'met-akkad'], 'schematic'))
    if last_judah is None:
        raise ValueError('Cliopatria no longer includes the reviewed Judah source geometry')
    selected.append(record('judah-late-core', 'Kingdom of Judah · approximate core', 'polity', -700, -587, last_judah, '#90a8ac',
                           'The heartland is carried forward schematically from the earlier source polygon. Judah remained a kingdom under changing Assyrian and Babylonian pressure until the fall of Jerusalem in 586 BCE; this is not an exact boundary.', ['cliopatria', 'met-israel'], 'schematic'))
    canaan = shape({'type': 'Polygon', 'coordinates': [[[34.25, 30.0], [35.5, 29.7], [36.7, 31.2], [36.5, 34.4], [35.7, 34.7], [34.8, 33.8], [34.0, 31.7], [34.25, 30.0]]]})
    selected.append(record('canaan-region', 'Canaan · cultural region', 'culture', -2000, -1100, canaan, '#9f9468',
                           'Broad, hand-drawn cultural geography. Canaan contained multiple cities and shifting Egyptian influence, especially in the Late Bronze Age. This is not one kingdom or a fixed border.', ['met-canaan'], 'schematic'))
    judea = shape({'type': 'Polygon', 'coordinates': [[[34.4, 30.2], [35.4, 30.2], [35.8, 31.1], [35.75, 32.5], [35.15, 32.8], [34.4, 31.7], [34.4, 30.2]]]})
    selected.append(record('judea-region', 'Judea · region', 'culture', -100, 100, judea, '#90a8ac',
                           'A hand-drawn regional guide across changing local and Roman political arrangements. It does not imply an independent state or surveyed frontier.', ['met-israel'], 'schematic'))

    places = [
        ('ur', 'Ur', -3000, -500, 30.962, 46.105, 'City in Sumer; later capital of the Ur III state. The marker indicates the city, not its territorial reach.', 'https://pleiades.stoa.org/places/912985', ['pleiades', 'met-isin']),
        ('uruk', 'Uruk', -3400, -500, 31.323, 45.639, 'Major southern Mesopotamian city. Its political role changed across many periods.', 'https://pleiades.stoa.org/places/912986', ['pleiades', 'uruk']),
        ('kish', 'Kish', -3100, -500, 32.546, 44.593, 'City north of Sumer’s southern centers; one of the early competing dynastic centers.', 'https://pleiades.stoa.org/places/894028', ['pleiades', 'met-akkad']),
        ('nippur', 'Nippur', -2900, -500, 32.127, 45.231, 'Religious center retained by successive southern Mesopotamian rulers.', 'https://pleiades.stoa.org/places/912910', ['pleiades', 'met-isin']),
        ('lagash', 'Lagash', -2900, -2000, 31.419, 46.410, 'Sumerian city and political center in the late third millennium BCE.', 'https://pleiades.stoa.org/places/959120263', ['pleiades', 'met-akkad']),
        ('isin', 'Isin', -2004, -1763, 31.885, 45.269, 'A successor dynasty to Ur III and one of the rivals for southern Mesopotamia. These dates mark political prominence, not the city’s full occupation.', 'https://pleiades.stoa.org/places/912868', ['pleiades', 'met-isin']),
        ('larsa', 'Larsa', -2004, -1763, 31.283, 45.852, 'Rival southern Mesopotamian dynasty; its political prominence ended with Hammurabi’s conquest. These dates do not mark the city’s full occupation.', 'https://pleiades.stoa.org/places/912897', ['pleiades', 'met-isin']),
        ('babylon', 'Babylon', -1894, -500, 32.537, 44.425, 'City and later capital of major Babylonian states; its significance continued beyond this selected display window.', 'https://pleiades.stoa.org/places/893951', ['pleiades', 'met-isin']),
        ('ashur', 'Ashur', -2000, -609, 35.456, 43.261, 'City on the Tigris and enduring Assyrian religious center; Assyrian political capitals later changed.', 'https://pleiades.stoa.org/places/893945', ['pleiades', 'met-assyria']),
        ('nineveh', 'Nineveh', -1000, -612, 36.361, 43.160, 'Assyrian city and capital under Sennacherib in the seventh century BCE.', 'https://pleiades.stoa.org/places/874621', ['pleiades', 'met-assyria']),
        ('ebla', 'Ebla', -2500, -1600, 35.799, 36.798, 'Bronze Age Syrian city and kingdom, linked to wider Mesopotamian exchange.', 'https://pleiades.stoa.org/places/869702586', ['pleiades', 'met-canaan']),
        ('hazor', 'Hazor', -2000, -800, 33.019, 35.567, 'Canaanite city-state in the southern Levant. The broad window marks selected Bronze and Iron Age relevance.', 'https://pleiades.stoa.org/places/779967430', ['pleiades', 'met-canaan']),
        ('samaria', 'Samaria', -850, 100, 32.276, 35.190, 'Capital of the northern Kingdom of Israel, then center of an Assyrian province after about 722 BCE; later known as Sebaste.', 'https://pleiades.stoa.org/places/678370', ['pleiades', 'oracc-israel']),
        ('jerusalem', 'Jerusalem', -1000, 100, 31.777, 35.235, 'Capital of Judah and later a center of Judea. Political control and territorial names changed across this long interval.', 'https://pleiades.stoa.org/places/687928', ['pleiades', 'met-israel']),
    ]
    place_records = [{'id': id, 'name': name, 'kind': 'city', 'start': start, 'end': end, 'lat': lat, 'lon': lon,
                      'note': note, 'url': url, 'sources': sources} for id, name, start, end, lat, lon, note, url, sources in places]
    roles = {
        'ur': [(-3000, -2351, 'City within Sumerian city-state society'),
               (-2350, -2150, 'Sumerian city under Akkadian rule'),
               (-2112, -2004, 'Capital of the Ur III state'),
               (-2003, -500, 'City under successor southern Mesopotamian states')],
        'samaria': [(-850, -723, 'Capital of the Kingdom of Israel'),
                    (-722, -600, 'Center of an Assyrian province'),
                    (-599, 100, 'Samaria / later Sebaste under changing rulers')],
        'jerusalem': [(-1000, -587, 'Capital of the Kingdom of Judah'),
                      (-586, -539, 'Jerusalem after Babylonian conquest'),
                      (-538, 100, 'Regional center under changing rulers')],
    }
    for place in place_records:
        if place['id'] in roles:
            place['roles'] = [{'start': start, 'end': end, 'label': label} for start, end, label in roles[place['id']]]
    # A city marker's interval is a selected viewing window, not a foundation or
    # abandonment date. Keep the special provincial relationship date explicit.
    result = {'schemaVersion': 1, 'source': {'dataset': 'Cliopatria / Seshat', 'revision': REVISION, 'archive': URL,
              'sha256': digest, 'polygonsLicense': 'CC BY 4.0', 'placeSource': 'Pleiades; selected representative points',
              'placesLicense': 'CC BY 3.0',
              'interpretation': 'Curated date corrections and schematic regions documented in THIRD_PARTY.md'},
              'features': sorted(selected, key=lambda r: (r['start'], r['id'])), 'places': place_records}
    OUT.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False))
    print(f'{len(selected)} regional areas and {len(place_records)} places → {OUT} ({OUT.stat().st_size:,} bytes)')
    print('Cliopatria SHA-256', digest)


if __name__ == '__main__':
    main()
