#!/usr/bin/env python3
"""Rebuild the offline Human Atlas datasets. See the sketch README for inputs.

Requires numpy, rasterio, shapely. Raw archives stay outside the repository.
No network access is needed by the deployed sketch.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import json
import math
from pathlib import Path
import urllib.request

from shapely.geometry import shape, mapping

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data'
USER_AGENT = 'HumanAtlas-research-sketch/1.0'


def download(url, destination):
    destination = Path(destination)
    if not destination.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=90) as response:
            destination.write_bytes(response.read())
    return destination


def write_json(path, value):
    path.write_text(json.dumps(value, separators=(',', ':'), ensure_ascii=False))


def region(lat, lon):
    # Explicit analytical bins; these do not represent historical territories.
    if lon < -30:
        return 3 if lat >= 13 else 4
    if (lon >= 110 and lat < -10) or lon > 155:
        return 5
    if -20 <= lon < 53 and -36 <= lat < 36 and not (lon > 34 and lat > 12):
        return 0
    if lat >= 36 and -30 <= lon < 45:
        return 1
    return 2


def population(tif):
    import numpy as np
    import rasterio

    # Sum people, never average density or normalize to the largest year.
    # Read all interleaved bands in row blocks, not 75 complete raster passes.
    factor = 12
    with rasterio.open(tif) as src:
        assert src.width == 4320 and src.height == 2160 and src.count == 75
        years = [(-int(d[:-2]) if d.endswith('BC') else int(d[:-2])) for d in src.descriptions]
        grid = np.zeros((src.count, 180, 360), dtype=np.float64)
        for row in range(0, src.height, 72):
            block = src.read(window=rasterio.windows.Window(0, row, src.width, 72))
            block = np.nan_to_num(block, nan=0, posinf=0, neginf=0)
            assert block.min() >= 0
            grid[:, row // factor:(row + 72) // factor] = block.reshape(src.count, 6, factor, 360, factor).sum(axis=(2, 4), dtype=np.float64)
        mask = grid.max(axis=0) > 0
        cells = []
        for row, col in np.argwhere(mask):
            lat, lon = 89.5 - float(row), -179.5 + float(col)
            area = 6371.0088 ** 2 * math.pi / 180 * (math.sin(math.radians(lat + .5)) - math.sin(math.radians(lat - .5)))
            cells.append([lat, lon, round(area, 3), region(lat, lon)])
        values = grid[:, mask].astype('<f4')
        (OUT / 'population.f32').write_bytes(values.tobytes())
        meta = {
            'version': 1, 'source': 'hyde', 'resolutionDegrees': 1,
            'layout': 'little-endian float32; year-major, then cell index; people per cell',
            'years': years, 'cells': cells,
            'totals': [round(float(x)) for x in values.sum(axis=1, dtype=np.float64)],
            'regions': ['Africa', 'Europe', 'Asia', 'North America', 'South America', 'Oceania'],
            'note': 'HYDE 3.2 baseline, aggregated from 5 arc minutes. Density uses whole grid-cell area, including coastal water. Regional bins are geographic approximations. Year 0 in the source is displayed as 1 BCE.',
            'sha256': hashlib.sha256(values.tobytes()).hexdigest(),
        }
        write_json(OUT / 'population.json', meta)
        print('Population:', len(cells), 'cells ×', len(years), 'years;', len(values.tobytes()), 'bytes', flush=True)


def population_detail(tif):
    import numpy as np
    import rasterio

    """Real finer aggregations, with separate date files for bounded downloads."""
    with rasterio.open(tif) as src:
        assert (src.width, src.height, src.count) == (4320, 2160, 75)
        years = [(-int(d[:-2]) if d.endswith('BC') else int(d[:-2])) for d in src.descriptions]
        # One source pass builds both resolutions; every native cell contributes.
        grids = {factor: np.zeros((75, 2160 // factor, 4320 // factor), dtype=np.float64) for factor in (6, 3)}
        for row in range(0, src.height, 72):
            block = np.nan_to_num(src.read(window=rasterio.windows.Window(0, row, src.width, 72)), nan=0, posinf=0, neginf=0)
            assert block.min() >= 0
            for factor, grid in grids.items():
                grid[:, row // factor:(row + 72) // factor] = block.reshape(75, 72 // factor, factor, 4320 // factor, factor).sum(axis=(2, 4), dtype=np.float64)
        for factor, grid in grids.items():
            resolution = factor / 12
            destination = OUT / f'population-{resolution:g}'
            destination.mkdir(exist_ok=True)
            mask = grid.max(axis=0) > 0
            cells = []
            for row, col in np.argwhere(mask):
                lat, lon = 90 - (float(row) + .5) * resolution, -180 + (float(col) + .5) * resolution
                area = 6371.0088 ** 2 * math.radians(resolution) * (math.sin(math.radians(lat + resolution / 2)) - math.sin(math.radians(lat - resolution / 2)))
                cells.append([lat, lon, round(area, 3), region(lat, lon)])
            frames = []
            for i, year in enumerate(years):
                values = grid[i, mask].astype('<f4')
                binary = values.tobytes()
                filename = f'{year}.f32'
                (destination / filename).write_bytes(binary)
                frames.append({'year': year, 'file': filename, 'bytes': len(binary), 'total': round(float(values.sum(dtype=np.float64))), 'sha256': hashlib.sha256(binary).hexdigest()})
            write_json(destination / 'index.json', {
                'version': 1, 'source': 'hyde', 'resolutionDegrees': resolution,
                'sourceResolutionDegrees': 1 / 12,
                'layout': 'one little-endian float32 file per source date; cell index; people per cell',
                'years': years, 'cells': cells, 'frames': frames,
                'regions': ['Africa', 'Europe', 'Asia', 'North America', 'South America', 'Oceania'],
                'note': 'HYDE 3.2 baseline summed directly from the 5-arc-minute source. Whole-cell area includes coastal water. Finer model output does not imply more precise historical evidence. Charts and regional exports use the fixed 1-degree reference grid.',
            })
            print(f'Detail {resolution}°: {len(cells):,} cells × 75 dates; {len(binary):,} bytes per date', flush=True)


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(v) for v in value]
    return round(value, 3) if isinstance(value, float) else value


def geography(cache):
    url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson'
    land = json.loads(download(url, cache / 'land-50m.geojson').read_text())
    for feature in land['features']:
        feature['properties'] = {}
        feature['geometry']['coordinates'] = rounded(feature['geometry']['coordinates'])
    write_json(OUT / 'land.json', land)
    # Freeze a revision for reproducible boundary downloads and attribution.
    revision_file = cache / 'basemaps-revision.json'
    revision = json.loads(download('https://api.github.com/repos/aourednik/historical-basemaps/commits/master', revision_file).read_text())['sha']
    base = f'https://raw.githubusercontent.com/aourednik/historical-basemaps/{revision}'
    index = json.loads(download(base + '/index.json', cache / 'border-index.json').read_text())
    # Exclude the especially speculative deep-time maps, including a known
    # anachronistic -1500 snapshot. Early farming zones are curated separately.
    rows = [x for x in index['years'] if x['year'] >= -3000 and x['year'] != -1500]

    def prepare(row):
        original = download(base + '/geojson/' + row['filename'], cache / row['filename'])
        data = json.loads(original.read_text())
        features = []
        for feature in data['features']:
            if not feature.get('geometry'):
                continue
            geometry = shape(feature['geometry']).simplify(.12, preserve_topology=True)
            if geometry.is_empty:
                continue
            props = feature.get('properties') or {}
            name = str(props.get('NAME') or '').strip()
            if not name:
                continue
            features.append({'type': 'Feature', 'properties': {'name': name, 'subject': str(props.get('SUBJECTO') or ''), 'precision': props.get('BORDERPRECISION')}, 'geometry': {'type': geometry.geom_type, 'coordinates': rounded(mapping(geometry)['coordinates'])}})
        filename = str(row['year']) + '.json'
        write_json(OUT / 'borders' / filename, {'type': 'FeatureCollection', 'features': features})
        return {'year': row['year'], 'file': filename, 'features': len(features), 'original': row['filename'], 'sha256': hashlib.sha256(original.read_bytes()).hexdigest()}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        prepared = list(pool.map(prepare, rows))
    write_json(OUT / 'borders.json', {'source': 'basemaps', 'revision': revision, 'snapshots': sorted(prepared, key=lambda x: x['year'])})
    download(base + '/LICENSE', OUT / 'BORDERS-LICENSE.txt')
    print('Geography:', len(prepared), 'boundary snapshots', flush=True)


def comparison(cache):
    path = download('https://ourworldindata.org/grapher/population.csv?v=1&csvType=full&useColumnShortNames=false', cache / 'owid-population.csv')
    data = {}
    for row in csv.DictReader(path.open()):
        if row['Entity'] in ['World', 'Africa', 'Europe', 'Asia', 'North America', 'South America', 'Oceania'] and int(row['Year']) <= 2023:
            data.setdefault(row['Entity'], []).append([int(row['Year']), float(row['Population'])])
    write_json(OUT / 'comparison.json', {'source': 'owid', 'series': data, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    print('OWID comparison:', len(data), 'series', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('/tmp/human-atlas-source'))
    parser.add_argument('--population-tif', type=Path)
    parser.add_argument('--population-detail-only', action='store_true', help='Rebuild only the optional 0.5° and 0.25° date files from --population-tif')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    (OUT / 'borders').mkdir(parents=True, exist_ok=True)
    if args.population_detail_only:
        if not args.population_tif:
            parser.error('--population-detail-only requires --population-tif')
        population_detail(args.population_tif)
        raise SystemExit(0)
    if args.population_tif:
        population(args.population_tif)
        population_detail(args.population_tif)
    geography(args.cache)
    comparison(args.cache)
