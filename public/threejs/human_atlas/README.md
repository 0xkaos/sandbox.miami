# Human Atlas

An offline-capable Three.js sketch for exploring population, migration, and historical context. Open **`/threejs/human_atlas/`** after `npm run dev`. It is automatically listed in the project catalog by `npm run build`.

The main story covers 50,000+ years, with a timeline extending to 70,000 BCE for earlier dispersal context. The latest population map is **2017 CE**, not the present day.

## What is included

- A rotatable, zoomable globe with **52,498 population cells at the default 0.5° resolution, optional 1° and 0.25° grids, and 75 dates**, using actual HYDE 3.2 gridded reconstructions from 10,000 BCE to 2017 CE.
- **48 historical boundary snapshots**, from 3000 BCE to 2010 CE, plus two deliberately schematic early farming zones.
- **13 migration corridors** and **27 curated historical records**, with denser coverage of Europe and the Mediterranean. Themes include migration, urban society, writing, industrial technology, religions and polytheistic traditions, famines, and plague.
- Study-specific ancestry illustrations for early farmers, German Corded Ware, and Beaker-period Britain. Other routes explain qualitative genetic or archaeological evidence.
- Seven geographic views; exact-year entry; chapter navigation; previous/next event; layer controls; shared URLs; and local research imports.
- Global or regional snapshot charts, with SVG, population-grid CSV, and contextual JSON downloads. A separate OWID world-population series provides a comparison without altering the map.

All runtime assets are served from this repository. Three.js and OrbitControls reuse the existing local copies in `../acoustic_chamber/vendor/`. There are no runtime data APIs, analytics, API keys, new npm dependencies, or remote font requests.

## Controls

Drag to orbit. Scroll or pinch to zoom. Click a place or event to pause and inspect it. The region buttons and `+`/`−` buttons provide alternatives to pointer navigation. The crosshair returns to the selected region's camera view.

Play traverses the timeline in about three minutes at 1× in **era-weighted** mode. Equal timeline segments represent unequal historical spans, leaving room to explore later history. The alternative **100 years / sec** mode advances at a constant chronological rate. The speed multiplier applies to either mode. Playback stops at 2017; pressing play at the endpoint restarts at the beginning. Opening a dialog or hiding the browser tab pauses playback.

Click the large date for exact-year entry. With the globe focused, **Space** toggles playback and **← / →** steps through time (1,000 years in deep time, 100 years BCE, 10 years CE). Controls remain accessible on narrow screens through **Controls** in the header.

The default view uses **0.5° resolution and 50% spike visibility**. Saved URLs retain their explicitly selected settings. Under **Population appearance**, use **Spike visibility** (0–100%) to reveal territory colors beneath the population layer, and **Spike height** (0.05–10×) to adjust magnification continuously. The population toggle still turns the layer off without losing these settings. **Population resolution** selects a real source aggregation; the frame-rate readout runs during playback.

The URL records the date, selected region, height mapping, magnification, spike visibility, population resolution, and layer visibility. Imported records remain in the current tab only and are not included in a shared URL.

## How to read the map

### Population and scale

Population values are summed directly from the source's 5-arc-minute raster into **1°, 0.5°, or 0.25° cells**. No synthetic settlement distribution is used. Zero population and unavailable data are distinct: **there are no headcounts before 10,000 BCE**. No population is extrapolated into that gap.

Density is people divided by the **whole spherical grid-cell footprint**, including coastal water. It is not the density of a city, nor population divided only by inhabited land. Coastal cells can place a spike over water. The place inspector reports the nearest available cell within 170 km at 1°, 85 km at 0.5°, or 42.5 km at 0.25°, identifies its center and resolution, and does not label it as a settlement count. Small islands missing from the source cannot be recovered by aggregation.

Heights stay on a fixed scale throughout the timeline:

```text
default: height / globe radius = 0.1 × log10(1 + people/km²)
linear:  height / globe radius = 0.00015 × people/km²
```

The continuous height slider multiplies these heights explicitly from 0.05× to 10× (default 1×). Visibility adjusts only transparency; it never changes population values or spike height. Camera zoom does not change the density-to-height mapping. No value is divided by the maximum or total population of the selected year. Log height makes small densities visible while compressing ratios; choose linear height to preserve density ratios. Very tall spikes can fill the view at high magnification; zoom out or lower magnification.

| Display grid | Population cells | Count data per source date | Use |
| --- | ---: | ---: | --- |
| 1° | 15,098 | Included in the initial 4.53 MB series | Lowest graphics cost |
| 0.5° (default) | 52,498 | 210 KB | More detail at regional zoom |
| 0.25° | 185,566 | 742 KB | Highest bundled detail; try the frame-rate readout |

Finer grids are aggregated from the original raster, not subdivided or invented from the 1° grid. They retain all 75 source dates and preserve counts within each original 1° cell to Float32 rounding. Finer model resolution does not establish more precise ancient evidence. Native 5-arc-minute rendering is not bundled.

The 1° reference series loads for charts and totals. The default view also loads the 0.5° cell metadata and adjoining dates; 0.25° data loads only when selected. Each finer grid caches up to eight dates and prefetches the next date during forward playback. While a date loads, the last population display remains visible with its date explicitly identified; population is hidden before the quantitative record begins. Superseded date requests are canceled when scrubbing. Failures keep the existing display and offer a resolution change to retry. Changing resolution releases the previous detail cache and spike mesh. Spike orientation is fixed per grid and heights are evaluated on the GPU; the finer grids still require more triangles and memory.

Regional charts, headline totals, and CSV/JSON/SVG snapshots always use the **1° reference grid** so geographic bin edges and summary values stay comparable across display resolutions. Clicking the globe inspects the selected display grid.

Population counts interpolate **linearly in people per cell**, preserving totals between neighboring source dates. Float32 storage introduces small numerical rounding, not a new demographic model. The baseline contains no bundled lower/upper confidence intervals. Interpolation does not resolve short famines, epidemics, or sudden local changes between coarse dates. Event cards do **not** add extra population losses, which would double-count effects or invent unsupported magnitudes.

The source uses a year-0 sample. Its display label is **1 BCE**; the raw year 0 is preserved in exported provenance. Exact-year entry does not accept a year zero. BCE date ranges and deep-time conversions remain approximate at this sketch's resolution.

### Geography and territories

Natural Earth provides fixed **modern coastlines**. The viewer does not model changing sea levels, glacial extent, submerged shelf settlement, or paleocoastlines. This is particularly significant for Beringia, Sunda, Sahul, and Ice Age Europe.

Historical Basemaps supplies named geographic reconstructions with disputed and sometimes dated interpretations. Some entries describe cultural areas, not states. Geometry is simplified by 0.12° for this regional-scale viewer. The especially speculative deep-time files and a known problematic 1500 BCE snapshot are excluded. The remaining maps are not independently vetted authoritative borders.

The viewer **crossfades two dated polygon maps on one surface**. Alpha is blended without darkening areas present in both maps. Current colors stay visible until new data are ready; pair changes blend over 280 ms, with at most six prepared boundary textures retained. Boundary errors retain the previous map and show a notice. Smooth visual transitions can briefly lag the date while new snapshots load. It does not infer a sequence of conquests or continuously deform polygons into supposedly known intervening borders. Inspecting a place reports labels from both adjoining snapshots, each with its own date. After 2010 the last boundary map is explicitly held. Before 3000 BCE only selected early farming zones appear, and those are illustrative areas of activity, not political boundaries.

Snapshot regions use explicit fixed geographic bins, defined in the preparation script, and a Mediterranean bounding box. They are approximate analytical areas, not historical nations or an official continent classification. Political-territory population totals are not calculated. Simply moving the camera does not silently redefine the selected region.

### Migration and ancestry

Every corridor is manually drawn to illustrate a published interpretation. The display smooths each corridor through its waypoints and keeps route lines and traveling markers close to the globe. Lines are not GPS paths; animated dots do not measure the number of migrants, journeys, or the speed of travel. Early dispersal hypotheses can overlap and disagree.

Ancestry illustrations have deliberately narrow scopes:

- Mathieson et al. (2018): a **qualitative** farmer/hunter-gatherer blend. No quantitative European-wide fraction is asserted.
- Haak et al. (2015): approximately **75% Yamnaya-related ancestry in sampled German Corded Ware individuals**.
- Olalde et al. (2018): approximately **90% ancestry turnover in Britain** over several centuries.

The circular sending/receiving footprints and intermediate color fractions are visual assumptions. With ancestry colors enabled, ordinary population growth changes spike height without changing its hue; migration progress controls the study blend separately. Counts are never changed by these colors. Tint is shown only during each study's configured time window, not carried into modern populations. Colors do not encode race, citizenship, language, or a claim of homogeneous ancient peoples. The AADR sample-level dataset has been researched but **is not imported**.

### Historical moments and exports

“Near this time” includes events within a stated contextual time window. It can include events before or after the selected year; every card supplies its actual date interval. Selecting a place narrows nearby records to 1,800 km. Empty lists are coverage gaps, not a historical claim. Religious points mark places discussed in the cited source, not distributions or counts of believers. The 1918 pandemic marker does not claim its geographic origin.

Snapshots use the **selected named geographic region**, not the current camera frustum or the clicked cell. The context follows the selected theme filter. On phones, swipe the chart horizontally to read it at full size. SVG charts show the longer population trajectory with the snapshot date marked; their population axis is logarithmic and their time axis is era weighted. The JSON contains source URLs, event intervals, active migrations, boundary status, and limits. Its active migration list is explicitly global context, not clipped to the snapshot region. CSV rows identify the two population source dates and interpolation weight. CSV export is disabled before the population record begins.

## Sources and expansion

Full source records and URLs are in [`history.mjs`](history.mjs) and **Sources & methods** in the app. Integrated data, curated literature, and candidate datasets have different statuses.

See [`DATA_REVIEW.md`](DATA_REVIEW.md) for the four user-suggested sources: TimelineConsortium, History Explorer, and the two Kaggle collections. Their raw text and event claims have not been silently merged into the curated map.

Priority extensions are native-resolution HYDE tiles for close zoom; published paleodemographic ranges before 10,000 BCE; paleocoastlines; AADR sample metadata with publication-specific ancestry models; Seshat polity attributes; Pleiades places; and reviewed, geocoded event records. The existing import format supports additional events and qualitative migration routes now.

### Local research format

Use **Sources & methods → Import research JSON**. A file is validated completely before anything is added. It must be below 4 MB and may contain at most 100 sources, 2,000 events, and 100 routes. Source links must use HTTP(S). IDs must be unique, including against existing records. All date intervals must fit 70,000 BCE–2017 CE. Negative years denote BCE.

```json
{
  "schemaVersion": 1,
  "sources": [{
    "id": "your-paper",
    "title": "Title of the original research",
    "author": "Author and publication year",
    "url": "https://example.org/research",
    "detail": "What this source establishes and what remains uncertain."
  }],
  "events": [{
    "id": "your-event",
    "title": "A sourced local development",
    "kind": "technology",
    "start": -3200,
    "end": -3000,
    "lat": 31.3,
    "lon": 45.6,
    "region": 2,
    "sources": ["your-paper"],
    "detail": "A short account with a clearly stated scope.",
    "certainty": "Approximate archaeological interval"
  }],
  "migrations": [{
    "id": "your-route",
    "title": "A schematic movement",
    "start": -3300,
    "end": -2500,
    "points": [[48, 44], [49, 30], [51, 11]],
    "color": "#b8a0e9",
    "sources": ["your-paper"],
    "detail": "Explain which elements are documented and which are schematic."
  }]
}
```

Region codes are `0 Africa`, `1 Europe`, `2 Asia`, `3 North America`, `4 South America`, `5 Oceania`. Route points are **[latitude, longitude]**, unlike GeoJSON's longitude-first order. Themes are `migration`, `technology`, `society`, `religion`, `famine`, `plague`, and `climate`. Routes need 2–40 waypoints and a nonzero date span. Quantitative ancestry blends require reviewing and editing `history.mjs`; the local importer rejects them instead of silently treating a percent as established evidence.

The example coordinates illustrate the format only. Replace the placeholder source and content with actual research before importing. Existing source IDs can be reused without defining them again.

## Data preparation

The deployed atlas data total roughly 91 MB including optional finer grids. The 1° reference population/geography needs roughly 5 MB plus the local Three.js module; the default 0.5° view adds its metadata and adjoining dates. Finer metadata (about 1.4 MB at 0.5° or 4.9 MB at 0.25°) and individual dates are fetched only when needed. Boundary files also load by date. No individual file exceeds Cloudflare's 25 MiB asset limit. Raw source archives are not shipped.

The committed artifacts allow normal builds with **no Python or network dependency**. To reproduce them, use a separate Python environment with `numpy`, `rasterio`, and `shapely`:

1. Download Harvard Dataverse file **4570054** (`raw-data.zip`, about 848 MB) from `https://dataverse.harvard.edu/api/access/datafile/4570054`, part of [doi:10.7910/DVN/E3H3AK](https://doi.org/10.7910/DVN/E3H3AK).
2. Extract `raw-data/HYDE.zip`, then `HYDE/popc.tif.zip`, then `popc.tif`. The uncompressed raster needs several GB of temporary space.
3. Run:

```sh
python scripts/prepare-human-atlas.py \
  --cache /tmp/human-atlas-source \
  --population-tif /tmp/human-atlas-source/population/popc.tif
```

The script sums all 75 population bands in row blocks, computes spherical areas, retains every cell with any positive population, and writes little-endian, year-major Float32 counts plus metadata. It downloads/simplifies boundaries, preserves hashes and their Git revision, downloads Natural Earth land, and prepares seven independent OWID comparison series. Source downloads are cached outside the repo. The bundled Basemaps revision is `da7a4b735ecef70aebdc9c73e409d8a2500d50f3`; preserve `basemaps-revision.json` and `border-index.json` in the cache to reproduce that revision. A fresh cache deliberately resolves the current revision, which requires reviewing the resulting changes.

`population.json` includes source-year totals and the SHA-256 of `population.f32`. Each optional `population-0.5/` and `population-0.25/` directory contains `index.json` with cell locations, areas, frame totals and SHA-256 hashes, plus 75 Float32 date files. Use `--population-detail-only` with `--population-tif` to rebuild just the optional grids without downloading geography. `borders.json` includes each original GeoJSON's SHA-256.

## Validation

```sh
node --test scripts/test-human-atlas.mjs
npm run build
```

Tests also check all finer-grid date checksums and totals, conservation within every original cell, lazy detail loading, interpolation, request cancellation, and error handling without repeated requests. Browser checks include both sliders, resolution switching, shared settings, mobile controls, delayed/failed boundary loads, smooth transitions, stale responses, and consistent snapshot totals. The original tests check the full binary checksum, every source-year total, nonnegative/finite cells, population-conserving interpolation, unavailable dates, region sums, fixed height mapping, timeline inversion, date-line/hole selection, all 48 boundary files, narrative source references, import validation, and snapshot provenance/CSV scope. Browser checks cover playback, date entry, globe picking, filters, layers, studies, downloads, imports, keyboard controls, responsive layout, and the WebGL fallback.

## Attribution and licenses

Application code follows this repository's MIT license. Third-party data retain their own terms; see [`THIRD_PARTY.md`](THIRD_PARTY.md). In particular, the historical boundary dataset is GPL-3.0 and its license is bundled at [`data/BORDERS-LICENSE.txt`](data/BORDERS-LICENSE.txt). This does not relabel all atlas data as MIT.
