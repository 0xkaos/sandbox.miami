#!/usr/bin/env python3
"""Build compact modern-reference rivers and topographic contours for Human Atlas."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from scipy.io import netcdf_file

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/threejs/human_atlas/data/physical.json'
USER_AGENT = 'HumanAtlas-research-sketch/1.0'
RIVERS_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson'
ETOPO1_URL = 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO1/data/ice_surface/grid_registered/netcdf/ETOPO1_Ice_g_gmt4.grd.gz'


def download(url, destination):
    if not destination.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=180) as response:
            destination.write_bytes(response.read())
    return destination


def rounded(value):
    if isinstance(value, (list, tuple)):
        return [rounded(item) for item in value]
    return round(float(value), 3)


def simplify_line(points, minimum_distance=.12):
    output = []
    for point in points:
        if not output or abs(point[0] - output[-1][0]) >= minimum_distance or abs(point[1] - output[-1][1]) >= minimum_distance:
            output.append(point)
    return output


def rivers(cache):
    source = json.loads(download(RIVERS_URL, cache / 'ne_50m_rivers_lake_centerlines.geojson').read_text())
    features = []
    for feature in source['features']:
        geometry = feature.get('geometry') or {}
        if geometry.get('type') not in ('LineString', 'MultiLineString'):
            continue
        paths = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
        paths = [rounded(line) for path in paths if len(path) > 1 if len(line := simplify_line(path)) > 1]
        if paths:
            name = (feature.get('properties') or {}).get('name_en') or (feature.get('properties') or {}).get('name')
            properties = {'name': name} if name else {}
            features.append({'type': 'Feature', 'properties': properties, 'geometry': {'type': 'MultiLineString', 'coordinates': paths}})
    return {'type': 'FeatureCollection', 'features': features}


def contours(cache):
    compressed = download(ETOPO1_URL, cache / 'ETOPO1_Ice_g_gmt4.grd.gz')
    grid_file = cache / 'ETOPO1_Ice_g_gmt4.grd'
    if not grid_file.exists():
        with gzip.open(compressed, 'rb') as source, grid_file.open('wb') as destination:
            shutil.copyfileobj(source, destination)
    with netcdf_file(grid_file, mmap=True) as data:
        elevation = data.variables['z'].data[::15, ::15].astype(float)
        x = data.variables['x'].data[::15].copy()
        y = data.variables['y'].data[::15].copy()
    elevation[elevation < 0] = np.nan
    levels = [500, 1000, 1500, 2000, 3000, 4000]
    contour_set = plt.contour(x, y, elevation, levels=levels)
    features = []
    for level, paths in zip(levels, contour_set.allsegs):
        for path in paths:
            simplified = simplify_line(path.tolist())
            if len(simplified) > 1:
                features.append({'type': 'Feature', 'properties': {'meters': level}, 'geometry': {'type': 'LineString', 'coordinates': rounded(simplified)}})
    plt.close()
    return {'type': 'FeatureCollection', 'features': features}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=Path('/tmp/human-atlas-physical'))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    river_data = rivers(args.cache)
    contour_data = contours(args.cache)
    payload = {
        'schemaVersion': 1,
        'note': 'Static modern physical reference. Rivers and terrain contours do not reconstruct past hydrology, shorelines, or elevation.',
        'sources': [
            {'dataset': 'Natural Earth 1:50m rivers and lake centerlines', 'url': RIVERS_URL, 'license': 'Public Domain'},
            {'dataset': 'NOAA ETOPO1 Ice Surface', 'url': ETOPO1_URL, 'license': 'Public Domain', 'contourIntervalMeters': 500, 'levelsMeters': [500, 1000, 1500, 2000, 3000, 4000]},
        ],
        'rivers': river_data,
        'contours': contour_data,
    }
    OUT.write_text(json.dumps(payload, separators=(',', ':')))
    print(f'Physical geography: {len(river_data["features"])} river features, {len(contour_data["features"])} contour features; {OUT.stat().st_size:,} bytes')
    print('sha256:', hashlib.sha256(OUT.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()