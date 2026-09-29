#!/usr/bin/env python3
"""Prepare the UNESCO catalog; date mentions are leads, never automatic phases.

Standard library only. Reads a separately downloaded, checksum-pinned CSV and
the reviewed phase file. A changed source requires review, not silent refresh.
"""
import argparse
import csv
import hashlib
from html import unescape
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / 'public/threejs/human_atlas'
SOURCE_SHA256 = '56aaa4e3ba16e526f758729d93d2850457d9e37974192bc601b1bb7e93357804'
DATASET = 'https://ihp-wins.unesco.org/dataset/88c8eff6-b94d-4826-bb13-7107ac4c02a9'
CSV_URL = DATASET + '/resource/2f46f6b2-45f9-402b-ace9-1e02c9c97a3d/download/whc-sites-2025.csv'


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'br', 'div', 'li'):
            self.parts.append(' ')

    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'li'):
            self.parts.append(' ')


def plain(text):
    parser = PlainText()
    parser.feed(text)
    return re.sub(r'\s+', ' ', unescape(''.join(parser.parts))).strip()


# Deliberately do not normalize these to dates: an era-qualified number may
# still describe a ruler, restoration, excavation, or an uncertain tradition.
NUMBER = r'\d{1,3}(?:,\d{3})+|\d{1,6}'
ORDINAL = r'(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)'
ERA = r'(?:B\.?\s?C\.?(?:E\.?)?|A\.?\s?D\.?|C\.?\s?E\.?)'
MENTIONS = re.compile(
    rf'\b(?:{ORDINAL})(?:\s*(?:-|–|—|to|and|or)\s*(?:{ORDINAL}))?[-\s]+(?:centur(?:y|ies)|millenni(?:um|a))(?:\s+{ERA})?'
    rf'|\b(?:{NUMBER})(?:\s*(?:-|–|—|to|and)\s*(?:{NUMBER}))?\s*(?:{ERA}|(?:years?\s+)?BP|years?\s+(?:ago|old))\b'
    rf'|\b(?:{ERA})\s*(?:{NUMBER})(?:\s*(?:-|–|—|to|and)\s*(?:{NUMBER}))?\b', re.I)


def date_mentions(text):
    out = []
    for match in MENTIONS.finditer(text):
        phrase = match.group()
        out.append({
            'text': phrase,
            'context': text[max(0, match.start() - 100):min(len(text), match.end() + 140)],
            'status': 'unreviewed',
            'basis': 'relative or BP; reference/calibration needed' if re.search(r'\bBP\b|years? (?:ago|old)', phrase, re.I) else 'calendar mention; subject and era need review',
        })
    return out


def region(lat, lon):
    # Same fixed analytical bins as prepare-human-atlas.py, not UNESCO regions.
    if lon < -30:
        return 3 if lat >= 13 else 4
    if (lon >= 110 and lat < -10) or lon > 155:
        return 5
    if -20 <= lon < 53 and -36 <= lat < 36 and not (lon > 34 and lat > 12):
        return 0
    if lat >= 36 and -30 <= lon < 45:
        return 1
    return 2


def prepare(csv_path):
    raw = csv_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('CSV checksum changed. Review the new source before updating the pinned checksum.')
    review_path = ATLAS / 'data/unesco-phases.json'
    reviews = json.loads(review_path.read_text())
    rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
    sites, ids = [], set()
    for row in rows:
        site_id = row['id_no']
        if site_id in ids:
            raise ValueError(f'Duplicate UNESCO ID: {site_id}')
        ids.add(site_id)
        lat = float(row['latitude']) if row['latitude'] else None
        lon = float(row['longitude']) if row['longitude'] else None
        located = lat is not None and lon is not None
        if located and not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f'Invalid coordinates: {site_id}')
        description = plain(row['short_description_en'])
        phases = reviews['sites'].get(site_id, [])
        for phase in phases:
            if not (-70000 <= phase['start'] <= phase['end'] <= 2017):
                raise ValueError(f'Invalid phase dates: {site_id}')
            if phase['quote'] not in description:
                raise ValueError(f'Review quote no longer matches description: {site_id}: {phase["quote"]}')
            if phase['precision'] not in ('year', 'approximate years', 'century', 'millennium'):
                raise ValueError(f'Missing date precision: {site_id}')
        sites.append({
            'id': f'unesco-{site_id}', 'unescoId': site_id, 'title': plain(row['name_en']),
            'lat': lat, 'lon': lon, 'region': region(lat, lon) if located else None,
            'country': plain(row['states_name_en']), 'category': row['category'],
            'inscribed': int(row['date_inscribed']),
            'url': f'https://whc.unesco.org/en/list/{site_id}/',
            'description': description, 'dateMentions': date_mentions(description),
            'phases': phases,
        })
    if set(reviews['sites']) - ids:
        raise ValueError('Reviewed phases reference missing UNESCO sites.')
    sites.sort(key=lambda site: site['title'].casefold())
    catalog = {
        'schemaVersion': 1,
        'source': {'title': 'World Heritage Site List (2025)', 'author': 'UNESCO World Heritage Centre / UNESCO IHP-WINS',
                   'url': DATASET, 'download': CSV_URL, 'sha256': SOURCE_SHA256,
                   'providerModified': '2025-07-24', 'reviewed': reviews['reviewed'],
                   'license': 'Creative Commons Attribution Share-Alike (version unspecified in IHP-WINS metadata)',
                   'licenseUrl': 'http://www.opendefinition.org/licenses/cc-by-sa',
                   'descriptionLicense': 'CC BY-SA 3.0 IGO',
                   'descriptionLicenseUrl': 'https://creativecommons.org/licenses/by-sa/3.0/igo/',
                   'changes': 'English fields selected; HTML removed; coordinates converted to numbers; approximate geographic bins, unreviewed date mentions, and reviewed phase interpretations added.',
                   'disclaimer': 'The present work is not an official UNESCO publication and shall not be considered as such'},
        'method': 'Only reviewed phases enter the timeline. Phase intervals describe the named evidence or activity, not total site lifespans. Century/millennium bounds are indexing conventions, not precise construction dates. Date mentions remain unreviewed research leads. Inscription years never date ancient occupation. UNESCO coordinates can represent a multi-part property; they are not building footprints.',
        'reviewFileSha256': hashlib.sha256(review_path.read_bytes()).hexdigest(),
        'counts': {'sites': len(sites), 'reviewedSites': sum(bool(s['phases']) for s in sites),
                   'phases': sum(len(s['phases']) for s in sites),
                   'unlocatedSites': sum(s['region'] is None for s in sites),
                   'sitesWithDateMentions': sum(bool(s['dateMentions']) for s in sites)},
        'sites': sites,
    }
    (ATLAS / 'data/unesco-sites.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(catalog['counts']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', type=Path, required=True)
    prepare(parser.parse_args().csv)
