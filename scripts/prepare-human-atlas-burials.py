#!/usr/bin/env python3
"""Build dated Corded Ware/Bell Beaker burial evidence from a pinned supplement.

Source: Bourgeois et al., Science Advances 11 eadx2262 (2025), CC BY 4.0.
The PMC Open Access S3 copy of the journal supplement contains one XLSX file.
This parser uses the Python standard library so no spreadsheet dependency is
needed to regenerate the output.
"""

import hashlib
import io
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/corded-beaker-burials.json'
CACHE = Path('/tmp/human-atlas-source/corded-beaker-burials.zip')
URL = 'https://pmc-oa-opendata.s3.amazonaws.com/PMC13155569.1/sciadv.adx2262_data_s1_to_s8.zip'
SHA256 = '4b0ae31e26fb161b5f04bf3186cd50e43eedba65d08b11bc445b6ffc0adda8bd'
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def source_bytes():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={'User-Agent': 'Human Atlas data preparation'})
        with urllib.request.urlopen(request, timeout=60) as response:
            CACHE.write_bytes(response.read())
    data = CACHE.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SHA256:
        raise ValueError(f'Burial supplement checksum changed: {digest}')
    return data


def spreadsheet_rows(workbook, sheet_number, shared):
    root = ET.fromstring(workbook.read(f'xl/worksheets/sheet{sheet_number}.xml'))
    raw_rows = []
    for xml_row in root.findall(f'.//{NS}row'):
        row = {}
        for cell in xml_row.findall(f'{NS}c'):
            column = re.match(r'[A-Z]+', cell.attrib['r']).group(0)
            value = cell.find(f'{NS}v')
            string = value.text if value is not None and value.text is not None else ''
            if cell.attrib.get('t') == 's' and string:
                string = shared[int(string)]
            elif cell.attrib.get('t') == 'inlineStr':
                string = ''.join(cell.itertext())
            row[column] = string
        raw_rows.append(row)
    header, *data = raw_rows
    return [{title: row.get(column, '') for column, title in header.items()} for row in data]


def optional_number(value):
    if not value or value in ('–', '-'):
        return None
    result = float(value)
    return int(result) if result.is_integer() else result


def event(row, tradition):
    modeled_mean = optional_number(row['Modelled Mean'])
    modeled_68 = [optional_number(row['Modelled from_68_3']), optional_number(row['Modelled to_68_3'])]
    modeled_95 = [optional_number(row['Modelled from 95,4']), optional_number(row['Modelled to 95,4'])]
    if modeled_mean is None or None in modeled_95:
        raise ValueError(f'Missing modeled age for {tradition} record {row["Burial ID"]}')
    if not modeled_95[0] <= modeled_mean <= modeled_95[1]:
        raise ValueError(f'Invalid modeled age range for {tradition} record {row["Burial ID"]}')
    prefix = 'cw' if tradition == 'Corded Ware' else 'bb'
    return {
        'id': f'{prefix}-{row["Burial ID"]}',
        'tradition': tradition,
        'regionalGroup': optional_number(row['Groups']),
        'region': row['Region'], 'country': row['Country'],
        'site': row['Site name'], 'grave': row['Grave nr.'],
        'lat': round(float(row['Latitude']), 6), 'lon': round(float(row['Longitude']), 6),
        'culture': row['Culture'], 'sampleId': row['ID'],
        'labId': row['Lab nr'],
        'radiocarbonBP': optional_number(row['14C BP']),
        'radiocarbonSd': optional_number(row['s.d.']),
        'sample': row['Sample'], 'directOrIndirect': row['Direct/indirect'],
        'mtDnaHaplogroup': row['mtDNA hg'], 'yHaplogroup': row['Y hg'],
        'sourceCitation': row['Source'],
        'notes': row['Notes'], 'graveDescription': row['Grave description'],
        'additionalDates': row['Additional date(s)'], 'burialRite': row['Burial rite'],
        'unmodeledMean': optional_number(row['Unmodelled Mean']),
        'unmodeledRange68': [optional_number(row['Unmodelled from_68_3']), optional_number(row['Unmodelled to_68_3'])],
        'unmodeledRange95': [optional_number(row['Unmodelled from 95,4']), optional_number(row['Unmodelled to 95,4'])],
        'modeledMean': modeled_mean, 'modeledRange68': modeled_68, 'modeledRange95': modeled_95,
        'modelAgreement': optional_number(row['Agreement']),
    }


def main():
    with zipfile.ZipFile(io.BytesIO(source_bytes())) as supplement:
        with zipfile.ZipFile(io.BytesIO(supplement.read('adx2262_data_s1_to_s8.xlsx'))) as workbook:
            shared = [''.join(item.itertext()) for item in ET.fromstring(workbook.read('xl/sharedStrings.xml')).findall(f'{NS}si')]
            cw = spreadsheet_rows(workbook, 1, shared)
            bb = spreadsheet_rows(workbook, 2, shared)
    if (len(cw), len(bb)) != (453, 514):
        raise ValueError(f'Unexpected supplement rows: {len(cw)} Corded Ware, {len(bb)} Bell Beaker')
    events = [event(row, 'Corded Ware') for row in cw] + [event(row, 'Bell Beaker') for row in bb]
    if len({record['id'] for record in events}) != len(events):
        raise ValueError('Burial IDs are not unique within the two source tables')
    result = {
        'schemaVersion': 1,
        'source': {
            'dataset': 'Spatiotemporal reconstruction of Corded Ware and Bell Beaker burial rituals',
            'authors': 'Bourgeois, Helmecke, Olerud, Djakovic, Castro Gonzales and Kroon (2025)',
            'paper': 'https://doi.org/10.1126/sciadv.adx2262',
            'metadata': 'https://pmc-oa-opendata.s3.amazonaws.com/metadata/PMC13155569.1.json',
            'url': URL, 'sha256': SHA256, 'license': 'CC BY 4.0',
            'tables': {'Corded Ware': 'Supplementary Data S1', 'Bell Beaker': 'Supplementary Data S2'},
            'interpretation': 'One record is one radiocarbon-dated burial event. Modelled 68.3% and 95.4% ranges express date uncertainty, not a continuous occupation or culture boundary. Tradition denotes the source table; the original Culture label is retained. Low-agreement events remain present and are flagged.',
        },
        'events': events,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    low = sum(record['modelAgreement'] is not None and record['modelAgreement'] <= 60 for record in events)
    print(f'{len(cw)} Corded Ware-table and {len(bb)} Bell Beaker-table burial events; {low} low-agreement records retained')
    print(f'{OUT}: {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
