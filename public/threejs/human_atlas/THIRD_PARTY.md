# Human Atlas: third-party sources

## HYDE population and its archive

Klein Goldewijk, K., Beusen, A., Doelman, J., and Stehfest, E. (2017). *Anthropogenic land use estimates for the Holocene – HYDE 3.2*. Earth System Science Data 9, 927–953. <https://doi.org/10.5194/essd-9-927-2017>.

Input: `popc.tif` (75 bands) from `raw-data.zip`, file 4570054, in the Anthromes 12K reproducibility archive: <https://doi.org/10.7910/DVN/E3H3AK>. The archive's API identifies its release as **CC0 1.0**. The archive README explicitly asks users of the included HYDE inputs to cite the original HYDE publication. These derived 1°, 0.5°, and 0.25° grids preserve that credit. No publication prose or figures are redistributed.

Transformations: NaN ocean/missing raster values excluded from sums; positive population cells aggregated by summing 12×12 source pixels; spherical cell areas computed; floats converted to Float32; approximate fixed region codes added. The retained mask covers cells with positive population in at least one sample. This is a baseline reconstruction; lower and upper scenarios are not included.

## Historical Basemaps

Copyright André Ourednik and contributors. **GPL-3.0**. Repository: <https://github.com/aourednik/historical-basemaps>.

Derived data: `data/borders/*.json`. Full license: [BORDERS-LICENSE.txt](data/BORDERS-LICENSE.txt). Original revision, filenames, and hashes: [borders.json](data/borders.json). Original source for the bundled revision: <https://github.com/aourednik/historical-basemaps/tree/da7a4b735ecef70aebdc9c73e409d8a2500d50f3/geojson>.

Modifications: retain 48 snapshots at/after 3000 BCE, excluding 1500 BCE; simplify geometry by 0.12° with topology preservation; round coordinates to three decimal places; retain names, controlling-subject strings, and source precision; remove empty/unnamed geometry. The preparation script is included in this repository so these adaptations can be reproduced. The dataset remains distinct from the application code and other data. The early global "Ur," "Semites," and "Canaan" labels, and the later "Judea" label, are suppressed in the viewer where the regional edition provides more specific types and dates; the original source records remain in the bundled snapshot files.

## Near East regional detail

`data/near-east.json` includes selected polity polygons from **Cliopatria**, part of the Seshat Global History Databank, copyright its authors and contributors, **CC BY 4.0**. Source: <https://github.com/Seshat-Global-History-Databank/cliopatria>, pinned revision `ad28a691b7c07c1fca89d0e0636d324667d2a258`, archive SHA-256 `d01ae3a20d358cc5d54f69d9d725d390767d9c8759ac89ad6f90c58d106f3370`. The source archive is not redistributed. `scripts/prepare-human-atlas-region.py` downloads that revision, selects records, simplifies geometry by 0.035° with topology preservation, and rounds coordinates to three decimals. The regional geometry is an adapted portion of Cliopatria, with attribution retained in the bundled data and JSON snapshots.

The same file contains selected **Pleiades** representative points and stable place identifiers, copyright the Pleiades contributors, **CC BY 3.0**. Source: <https://pleiades.stoa.org/downloads>, GIS export <https://atlantides.org/downloads/pleiades/gis/pleiades_gis_data.zip>, retrieved 2026-09-29, ZIP SHA-256 `7c0ef2f1483cec0618e0a7c41cfbb15a66307fac46ec5a839fb3672e7eecaf28`. City coordinates are rounded to three decimal places, with individual Pleiades URLs in each record. Ur uses the located [Ur(i) record](https://pleiades.stoa.org/places/912985); a separate generic "Ur" gazetteer record in the export is unlocated. City marker date windows are editorial selections rather than Pleiades settlement lifespans.

Editorial geometry and chronological adjustments are identified in the record notes. The Sumer cultural envelope unions early city-state source polygons. The Ur III and Canaan/Judea areas are hand-drawn schematic guides; the late Judah core carries an earlier Cliopatria heartland outline forward with a warning. The Akkadian first/last shapes are held to ca. 2350/2150 BCE, Israel is ended at 722 BCE, Neo-Assyria around 609 BCE, and Neo-Babylonia at ca. 626/539 BCE. The governing chronology and interpretation come from the linked [Met Akkadian](https://www.metmuseum.org/essays/the-akkadian-period-ca-2350-2150-b-c), [Met Isin-Larsa](https://www.metmuseum.org/essays/the-isin-larsa-and-old-babylonian-periods-2004-1595-b-c), [Met Assyria](https://www.metmuseum.org/essays/assyria-1365-609-b-c), [Met eastern Mediterranean](https://www.metmuseum.org/toah/ht/03/wae.html), [Met Israel/Judah](https://www.metmuseum.org/perspectives/cyrus-and-the-judean-diaspora), and [ORACC Israel](https://oracc.museum.upenn.edu/saao/aebp/essentials/countries/israel/) accounts. These institutions did not supply the hand-drawn coordinates or endorse the atlas.

## Natural Earth

Natural Earth contributors, 1:110m physical land. **Public domain**. <https://www.naturalearthdata.com/about/terms-of-use/>. Input: <https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson>. Properties removed and coordinates rounded to three decimals. Modern land geometry is reused without reconstructing historical coastlines.

## Our World in Data comparison

**HYDE (2023); Gapminder (2022); UN WPP (2024) – with major processing by Our World in Data.** Source, methodology, and underlying-provider terms: <https://ourworldindata.org/grapher/population>.

Retrieved 2026-09-29 through the chart's documented CSV endpoint. `comparison.json` retains seven published geographic series through 2023 and a SHA-256 of the downloaded CSV. The app uses the world series as a separate comparison; it does not substitute OWID totals into the HYDE 3.2 grid. OWID's own work is CC BY; underlying data retain the original providers' terms, linked from the data page. Attribute those providers when reusing the comparison.

## UNESCO heritage catalog

`data/unesco-sites.json` derives from **UNESCO World Heritage Centre / UNESCO IHP-WINS, World Heritage Site List (2025)**, supplied by the user. Source: [dataset](https://ihp-wins.unesco.org/dataset/88c8eff6-b94d-4826-bb13-7107ac4c02a9), [CSV](https://ihp-wins.unesco.org/dataset/88c8eff6-b94d-4826-bb13-7107ac4c02a9/resource/2f46f6b2-45f9-402b-ace9-1e02c9c97a3d/download/whc-sites-2025.csv), [provider metadata](https://ihp-wins.unesco.org/api/3/action/package_show?id=88c8eff6-b94d-4826-bb13-7107ac4c02a9). Provider modification date: 2025-07-24; checked 2026-09-29. CSV SHA-256: `56aaa4e3ba16e526f758729d93d2850457d9e37974192bc601b1bb7e93357804`.

IHP-WINS declares `license_id: cc-by-sa`, **Creative Commons Attribution Share-Alike**, linking to `http://www.opendefinition.org/licenses/cc-by-sa`; it does **not specify a version** in that metadata. Preserve that declaration when reusing the tabular catalog. UNESCO's English property descriptions are specifically published under **[CC BY-SA 3.0 IGO](https://creativecommons.org/licenses/by-sa/3.0/igo/)**, as displayed on the [Jericho](https://whc.unesco.org/en/list/1687/) and [Göbekli Tepe](https://whc.unesco.org/en/list/1572/) property pages. This specific licensing is the basis for the included description text; it does not grant rights to UNESCO photographs, logos, or unrelated materials.

Changes: selected English fields; stripped HTML and normalized whitespace; converted numeric fields; added analytical region bins, unreviewed date-mention extraction, and editorial phase interpretations. The adapted descriptions and additions in `data/unesco-phases.json` are shared under **CC BY-SA 3.0 IGO**. Tabular source fields retain the provider's CC BY-SA declaration. Individual property URLs and attribution are preserved in the catalog and contextual JSON exports. Neither data file is covered by the application's MIT license. UNESCO does not endorse the interpretation or the atlas.

**The present work is not an official UNESCO publication and shall not be considered as such.**

## Three.js

The sketch imports existing local copies of Three.js and OrbitControls from the neighboring acoustic-chamber sketch. **MIT**, copyright the Three.js authors. License already present at `../acoustic_chamber/vendor/THREE.LICENSE`. No additional third-party runtime libraries are included.

## Curated records and candidate data

`history.mjs` contains short original summaries and manually drawn schematic routes, each linked to its supporting publication or institution. Full paper texts, figures, genotype records, museum images, and data from candidate sources are not included. Citation does not mean that a source supplied the route's exact coordinates or every intermediate animation date; those are stated visual assumptions.

The four earlier user-suggested candidate datasets are assessed in [DATA_REVIEW.md](DATA_REVIEW.md). Their repository or uploader licenses are recorded there without assuming they replace upstream rights. Their raw text is not bundled. The separately supplied UNESCO catalog is integrated as described above.
