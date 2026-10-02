#!/usr/bin/env python3
"""Build a small, dated language-evidence catalog from the EDH TEI release.

The selected records are inscriptions with a stated date interval, edition
language, and a mapped findspot. They are examples of surviving written
evidence, not language territories, speaker counts, or a complete corpus.
"""

import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/language-attestations.json'
REVISION = '45f166654ab4551a1954617a0df8e56fa7724ccb'
BASE = f'https://raw.githubusercontent.com/epigraphic-database-heidelberg/data/{REVISION}/'
CACHE = Path('/tmp/human-atlas-source/edh-45f16665')
GEOGRAPHY_FILE = 'geography/edhGeographicData.json'
GEOGRAPHY_SHA256 = '4d76a3984009165981dcba0d3f8f20f920589f2e3fc5a82b8273b2e90e660595'
TEI = '{http://www.tei-c.org/ns/1.0}'
XML_LANG = '{http://www.w3.org/XML/1998/namespace}lang'
LANGUAGE_NAMES = {'la': 'Latin', 'grc': 'Ancient Greek'}

# The HD-to-G links were checked against EDH's own inscription pages. They
# select the findspot geography record; an ancient-place gazetteer centroid
# would not necessarily locate the actual findspot.
RECORDS = (
    ('HD000007', 'G019483', 'f65866aef6fe29e3cea9116239576e562e92f134d6caa1463eacabece98163fc'),
    ('HD000468', 'G012721', 'aec0b55ebfec03bf31a60005673ce538b95e89f629b7fb5ee51d8cffdbbc352c'),
    ('HD001964', 'G011741', 'df30aa8d605f003023fcd9df95bbf31eb15981037e001f97958d858d00fde40e'),
    ('HD002036', 'G001092', '6b5b555da97eda1ef25196fa5231a4968700867e0683ce0163798081eec684ca'),
    ('HD003764', 'G008935', '7e01cf2e9832459f8ca1b3b4404e3227672974f9bec19a77f90f0ef1714dd62f'),
    ('HD004074', 'G011754', '1d3a18ba9c09e44b16ea5489af1a4285f55dad66215c74206823f2597d29e15c'),
    ('HD004092', 'G000515', '8f9f6051c0d794b70a73c63c9d7d97ca360e28385efa1c0b2a8639f17b35d2e1'),
    ('HD020615', 'G003629', 'aac4080bb5343f0708cef672437a5726b950395f6f4c87ffb06aa4a8cd7da605'),
    ('HD024068', 'G010822', '1a57dae4997c29f9be039f4e049d091bf40d12932a1f31cd286d3c8c97c314ef'),
    ('HD036969', 'G000045', 'a26e714c299866103d171c457829f5a4d7069e2c49935938f184267910dd89af'),
    ('HD037020', 'G000017', 'a4e65423fa9d553396a282884cde669ca286944aec8d77f7b2d878a9b3516504'),
    ('HD037135', 'G020199', 'd8e4ca19315d92453bbabe7ad52a1c034712cd7c7a50fa970c311493a24a3fb0'),
    ('HD037140', 'G020188', '9fa6739045a04cf80fb6ea1a31a79229f925d291a4195e397efb2afefc733195'),
    ('HD037146', 'G000151', '657ea895134dc70c44e936238b2f0fb7e7246368ed5470215b70eecf31880300'),
    ('HD037166', 'G000151', 'b159d7d10da6e35d6151169ef3611428967f0ca9af369ffd5573086072257c86'),
    ('HD037602', 'G011473', '94c755bded37368b91c5e9bcf17bafe85d645cbc6022201e9faea5bfaaab7c90'),
    ('HD039267', 'G009889', 'bc3f5f8fdff46506dd5cc4de63e38160e3680502422f9b711909b8c51e118b98'),
    ('HD044002', 'G020144', '3bb2db532c3754ff37dad7cd0e222a534e1bc3a5a3bff438e2992fcbe4b33de4'),
    ('HD056798', 'G000025', '972779b9dab0274b8a21f0c4de7237faa34162e36309c36671cbc9cfec45db88'),
    ('HD071363', 'G029828', '8ba8ceaf461a40aaeef8f1a779f4534c5cd95080b965dbe3f2e8802394fd09b2'),
)


def source_file(relative_path, expected_sha256):
    path = CACHE / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        request = urllib.request.Request(BASE + relative_path,
                                         headers={'User-Agent': 'Human Atlas source preparation'})
        partial = path.with_suffix(path.suffix + '.part')
        try:
            with urllib.request.urlopen(request, timeout=120) as response, partial.open('wb') as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            partial.replace(path)
        finally:
            partial.unlink(missing_ok=True)
    actual_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(f'{relative_path} checksum changed: expected {expected_sha256}, got {actual_sha256}')
    return path


def inscription_path(hd_id):
    number = int(hd_id[2:])
    return f'inscriptions/{(number - 1) // 10000 + 1}/{((number - 1) % 10000) // 1000 + 1}/{hd_id}.xml'


def text(element):
    return ' '.join(''.join(element.itertext()).split()) if element is not None else ''


def first_place_name(element):
    if element is None:
        return None
    for place_name in element.findall(f'{TEI}placeName'):
        if not place_name.get('type'):
            return text(place_name) or None
    return None


def geography_index(geojson):
    index = {}
    for feature in geojson['features']:
        uri = feature.get('properties', {}).get('uri', '')
        if not uri:
            continue
        number = int(uri.rsplit('/', 1)[-1])
        key = f'G{number:06d}'
        if key in index:
            raise ValueError(f'Duplicate EDH geography ID: {key}')
        index[key] = feature
    return index


def main():
    geojson = json.loads(source_file(GEOGRAPHY_FILE, GEOGRAPHY_SHA256).read_text(encoding='utf-8'))
    geographies = geography_index(geojson)
    records = []
    for hd_id, g_id, expected_sha256 in RECORDS:
        path = inscription_path(hd_id)
        root = ET.fromstring(source_file(path, expected_sha256).read_bytes())
        dates = root.findall(f'.//{TEI}origDate')
        editions = root.findall(f'.//{TEI}div[@type="edition"]')
        if len(dates) != 1 or len(editions) != 1:
            raise ValueError(f'Unexpected date or edition structure: {hd_id}')
        date = dates[0]
        if not date.get('notBefore-custom') or not date.get('notAfter-custom'):
            raise ValueError(f'No closed date interval: {hd_id}')
        start, end = int(date.get('notBefore-custom')), int(date.get('notAfter-custom'))
        if start > end:
            raise ValueError(f'Reversed date interval: {hd_id}')
        languages = [code.strip() for code in editions[0].get(XML_LANG, '').split(',')]
        if not languages or any(code not in LANGUAGE_NAMES for code in languages):
            raise ValueError(f'Unexpected text language for {hd_id}: {languages}')
        feature = geographies[g_id]
        if feature['geometry']['type'] != 'Point':
            raise ValueError(f'Unexpected findspot geometry: {g_id}')
        lon, lat = feature['geometry']['coordinates']
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError(f'Invalid coordinates: {g_id}')
        properties = feature['properties']
        ancient_findspot = properties.get('ancient_findspot') or first_place_name(root.find(f'.//{TEI}origPlace'))
        modern_findspot = first_place_name(root.find(f'.//{TEI}provenance[@type="found"]'))
        if not ancient_findspot and not modern_findspot:
            raise ValueError(f'No findspot name: {hd_id}')
        title = text(root.find(f'.//{TEI}title'))
        records.append({
            'id': f'edh:{hd_id}',
            'sourceId': hd_id,
            'geographyId': g_id,
            'start': start,
            'end': end,
            'dateLabel': text(date),
            'languages': [{'code': code, 'name': LANGUAGE_NAMES[code]} for code in languages],
            'lat': round(lat, 4),
            'lon': round(lon, 4),
            'ancientFindspot': ancient_findspot,
            'modernFindspot': modern_findspot,
            'placeLabel': ancient_findspot or modern_findspot,
            'sourceTitle': title,
            'sourceUrl': f'https://edh.ub.uni-heidelberg.de/edh/inschrift/{hd_id}',
            'geographyUrl': f'https://edh.ub.uni-heidelberg.de/edh/geographie/{g_id}',
            'teiUrl': BASE + path,
            'teiSha256': expected_sha256,
        })

    result = {
        'schemaVersion': 1,
        'kind': 'dated-written-language-attestations',
        'status': ('Curated examples of surviving inscriptions. Dates are EDH date intervals for the objects; '
                   'points are representative findspot coordinates. These do not show language territories, '
                   'speaker populations, origins, or continuous use throughout a date interval.'),
        'source': {
            'dataset': 'Epigraphic Database Heidelberg (EDH)',
            'attribution': ('Epigraphic Database Heidelberg (EDH), Heidelberg Academy of Sciences '
                            'and Humanities / Heidelberg University Library'),
            'repository': 'https://github.com/epigraphic-database-heidelberg/data',
            'revision': REVISION,
            'license': 'CC BY-SA 4.0',
            'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/',
            'modifications': ('Selected 20 records; extracted TEI dates, language tags, names and titles; '
                              'joined EDH findspot GeoJSON and rounded coordinates to four decimals.'),
            'geographyFile': {'url': BASE + GEOGRAPHY_FILE, 'sha256': GEOGRAPHY_SHA256},
            'recordCount': len(records),
            'selection': ('Hand-selected Latin and Ancient Greek records with closed dating intervals, '
                          'known edition language, and linked EDH findspot geography.'),
            'pointCaveat': ('EDH coordinates may be settlement centroids; per-record coordinate uncertainty '
                            'is not published in this export.'),
        },
        'records': sorted(records, key=lambda record: (record['start'], record['sourceId'])),
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(records)} dated language attestations → {OUT} ({OUT.stat().st_size:,} bytes)')
    print(f'EDH geography SHA-256 {GEOGRAPHY_SHA256}')


if __name__ == '__main__':
    main()
