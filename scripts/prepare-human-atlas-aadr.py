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
NOTABLE_GROUPS = {
    'Altai_Neanderthal': 'Altai Neanderthal',
    'ChagyrskayaCave_Neanderthal': 'Chagyrskaya Cave Neanderthal',
    'France_GrotteMandrin_Neanderthal': 'Grotte Mandrin Neanderthal',
    'GoyetCave_Neanderthal': 'Goyet Cave Neanderthal',
    'LesCottescave_Neanderthal': 'Les Cottes Cave Neanderthal',
    'Mezmaiskayacave_Neanderthal': 'Mezmaiskaya Cave Neanderthal',
    'Russia_Denisova': 'Denisova',
    'Russia_Denisova_Neanderthal_Mix': 'Denisova Neanderthal mix',
    'Russia_DenisovaCave': 'Denisova Cave',
    'Russia_DenisovaCave_MPleistocene': 'Denisova Cave Middle Pleistocene',
    'SpyCave_Neanderthal': 'Spy Cave Neanderthal',
    'VindijaCave_Neanderthal': 'Vindija Cave Neanderthal',
    'Austria_N_LBK': 'Austria Neolithic LBK',
    'Russia_Samara_EBA_Yamnaya': 'Samara Early Bronze Age Yamnaya',
    'Czechia_EBA_CordedWare': 'Czechia Early Bronze Age Corded Ware',
    'Czechia_BellBeaker': 'Czechia Bell Beaker',
    'Russia_Chelyabinsk_MLBA_Sintashta': 'Chelyabinsk Middle/Late Bronze Age Sintashta',
    'Czechia_EBA_Unetice': 'Czechia Early Bronze Age Unetice',
    'Czechia_IA_LaTene': 'Czechia Iron Age La Tene',
    'Austria_Avar': 'Austria Avar',
    'Sweden_Viking': 'Sweden Viking',
    'England_Saxon': 'England Saxon',
    'Serbia_IronGates_Mesolithic': 'Serbia Iron Gates Mesolithic',
    'Turkey_N': 'Turkey Neolithic',
}
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
        'id': 'Genetic ID (', 'persistentGeneticId': 'Persistent Genetic ID', 'individualId': 'Individual ID',
        'skeletalCode': 'Skeletal code', 'skeletalElement': 'Skeletal element',
        'firstPublication': 'First publication:', 'dataRepository': 'Link to the most permanent repository',
        'publication': 'Publication abbreviation', 'publicationDOI': 'doi for publication',
        'dateType': 'Method for Determining Date', 'dateMeanBP': 'Date mean in BP',
        'dateStandardDeviationBP': 'Date standard deviation in BP', 'fullDate': 'Full Date One',
        'physicalAnthropology': 'Age at death, Morphological sex', 'pulldownStrategy': 'Pulldown Strategy',
        'dataType': 'Data type', 'libraryCount': 'No. Libraries', 'autosomalCoverage': 'Mean coverage on 1.15M',
        'familyRelations': 'Family relations', 'molecularSex': 'Molecular Sex', 'mtDNA': 'mtDNA haplogroup',
        'yDNATerminal': 'Y haplogroup in terminal mutation notation', 'yDNA': 'Y haplogroup  in ISOGG',
        'yDNAManual': 'Y haplogroup manually called',
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
        site = row.get('Locality', '').strip()
        latitude, longitude = row.get('Latitude', '').strip(), row.get('Longitude', '').strip()
        date, date_basis = date_range(row[column['fullDate']], row[column['dateMeanBP']], row[column['dateStandardDeviationBP']])
        if not site or latitude in {'.', '..'} or longitude in {'.', '..'} or date is None or row[column['dateType']].strip().lower() == 'modern':
            continue
        records.append({
            'id': row[column['id']],
            'sourceLabel': label,
            'persistentGeneticId': row[column['persistentGeneticId']].strip(),
            'individualId': row[column['individualId']].strip(),
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
            'physicalAnthropology': row[column['physicalAnthropology']].strip(),
            'pulldownStrategy': row[column['pulldownStrategy']].strip(),
            'dataType': row[column['dataType']].strip(),
            'libraryCount': row[column['libraryCount']].strip(),
            'autosomalCoverage': row[column['autosomalCoverage']].strip(),
            'familyRelations': row[column['familyRelations']].strip(),
            'firstPublication': row[column['firstPublication']].strip(),
            'publication': row[column['publication']].strip(),
            'publicationDOI': row[column['publicationDOI']].strip(),
            'dataRepository': row[column['dataRepository']].strip(),
            'molecularSex': row[column['molecularSex']].strip(),
            'mtDNAHaplogroup': row[column['mtDNA']].strip(),
            'yDNAHaplogroupTerminal': row[column['yDNATerminal']].strip(),
            'yDNAHaplogroup': row[column['yDNA']].strip(),
            'yDNAHaplogroupManual': row[column['yDNAManual']].strip(),
            'assessment': row.get('ASSESSMENT', '').strip(),
            'notableGroupId': label if label in NOTABLE_GROUPS else None,
        })
    records.sort(key=lambda record: (record['dateRange'][0], record['sourceLabel'], record['id']))
    if not records:
        raise ValueError('No selected AADR records were imported')
    if len({record['id'] for record in records}) != len(records):
        raise ValueError('AADR Genetic IDs are not unique')
    notable_groups = []
    for group_id, title in NOTABLE_GROUPS.items():
        members = [record for record in records if record['notableGroupId'] == group_id]
        if members:
            notable_groups.append({
                'id': group_id, 'title': title, 'sampleCount': len(members),
                'localityCount': len({record['site'] for record in members}),
                'directDateCount': sum(record['dateType'].startswith('Direct:') for record in members),
            })
    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'Allen Ancient DNA Resource v66.1 public annotations',
            'repository': 'https://doi.org/10.7910/DVN/FFIDCW',
            'file': 'v66.p1_1240K.aadr.PUB.anno', 'fileId': FILE_ID,
            'url': URL, 'sha256': digest, 'license': 'CC0 1.0',
            'selection': 'All rows with a source locality, coordinates, a usable source date, and a date method not marked Modern. Source Group IDs are retained verbatim; no Group ID is excluded for being unfamiliar, regional, or non-curated.',
            'interpretation': 'One record is an AADR ancient individual sample at a source locality. sourceLabel preserves the AADR Group ID verbatim. Point color is a stable function of that Group ID: records in the same Group ID share a color. The Group ID is not an admixture estimate or an independently mapped territory, population size, language, or route.',
            'notableGroups': notable_groups,
        },
        'records': records,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(records):,} AADR archaeological sample records')
    print(f'{OUT}: {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()