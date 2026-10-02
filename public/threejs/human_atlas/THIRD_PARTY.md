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

## European peoples and kingdoms

`data/european-peoples.json` adapts **Cliopatria / Seshat** polygons from the same pinned `ad28a691b7c07c1fca89d0e0636d324667d2a258` archive above, under **CC BY 4.0**. The source calls the features polities. `scripts/prepare-human-atlas-europe.py` selects 159 date-interval shapes for 20 names, simplifies them, preserves original interval dates, and distinguishes named peoples from kingdoms in the generated records. Known source anomalies and editorial holds are explained in the catalog metadata and generator. A named people's area is an approximate source reconstruction, not a surveyed ethnic frontier or evidence of a single unified state.

Ten additional ethnonym reference points use **Pleiades GIS**, **CC BY 3.0**, at pinned revision `0ba82f79f123bfea75d4c70a748a115fdd7ca703`; the generator records individual input-table checksums and stable Pleiades URLs. The point for a name such as Cherusci or Suebi is a geographic label, not a capital, political boundary, or demonstrated lifespan. Its displayed name-period window is deliberately distinguished from the dated polygon source.

## Corded Ware and Bell Beaker burials

`data/corded-beaker-burials.json` derives from Bourgeois, Q. P. J. et al. (2025), [*Spatiotemporal reconstruction of Corded Ware and Bell Beaker burial rituals reveals complex dynamics divergent from steppe ancestry*](https://doi.org/10.1126/sciadv.adx2262), *Science Advances*, and its [open supplementary data](https://pmc.ncbi.nlm.nih.gov/articles/PMC13155569/), **CC BY 4.0**. Supplement ZIP SHA-256: `4b0ae31e26fb161b5f04bf3186cd50e43eedba65d08b11bc445b6ffc0adda8bd`. `scripts/prepare-human-atlas-burials.py` parses the Corded Ware and Bell Beaker supplement tables into 967 geocoded, radiocarbon-dated burial-event rows, preserving source citation, grave description, lab identifiers, and modelled intervals. Sixteen low model-agreement rows are retained but omitted from default time queries. The 95.4% interval models uncertainty in burial date; a dot does not infer people, ancestry, language, territorial extent, or continuous activity.

## South Levant survey sites

## Allen Ancient DNA Resource samples

`data/aadr-archaeological-samples.json` derives from the Allen Ancient DNA Resource (AADR) [public annotation dataset](https://doi.org/10.7910/DVN/FFIDCW), v66.1 file `v66.p1_1240K.aadr.PUB.anno`, **CC0 1.0**. `scripts/prepare-human-atlas-aadr.py` records the source URL, Harvard Dataverse file ID, and source-file SHA-256, then selects geocoded, named-locality rows whose source `Group ID` contains Yamnaya, Catacomb, Sintashta, Urnfield, Hallstatt, La Tene, Wielbark, Mycenaean, Phoenician, Punic, Etruscan, or Roman. It retains the source label verbatim, date text/method, citation DOI, sample ID, and skeletal metadata. Each row is one ancient individual sample at a source locality; a Group ID is not a culture boundary, population, language, or route. Raw genomes and ancestry estimates are not bundled.

## Selected archaeological contexts

`data/archaeological-contexts.json` is an original, hand-curated starter gazetteer of named steppe, European, and Mediterranean evidence contexts. It does not redistribute external tabular data. Each row supplies a direct source link, broad display bounds, a coordinate for the named context, an evidence kind, and a caution about interpretation. The linked scholarly, museum, and UNESCO sources retain their own terms. The selection is not a corpus or a comprehensive chronology. Archaeological conventions, later historical associations, and material labels are retained as search aids and are never rendered as population identities, language ranges, ancestry, borders, or routes.

`data/levant-sites.json` adapts Titolo, A. and Palmisano, A., [*From Villages to Empires: Archaeological Settlements of the South Levant*](https://doi.org/10.5334/joad.158) and its [open dataset](https://github.com/UnitoAssyrianGovernance/villages-to-empire-dataset), **CC BY 4.0**. Pinned revision `a3537c67cc736fb929291c50a4928a0cd7136dd9`; source CSV SHA-256 `baabd1a5d6da2b7fdfca70662b3de03563c4a9b4d238ee6018022eaad66939c9`. `scripts/prepare-human-atlas-levant.py` normalizes and compresses 5,587 geocoded source-site records and 14,268 dated phase rows from surveyed parts of Samaria and Judah. Source types, morphology, sizes, citations, and location-quality codes remain in the generated data. Some source rows share a source ID; generated unique IDs preserve the separate records. A broad phase indicates reported archaeological evidence within a period, not uninterrupted occupation; type labels do not make an itemized finds catalog.

## EUROEVOL European sites and phases

`data/euroevol-sites.json` derives from Manning, K. et al.'s [EUROEVOL dataset](https://discovery.ucl.ac.uk/id/eprint/1469811/) and its [data paper](https://doi.org/10.5334/joad.40), released **CC0 1.0** by the data provider. `scripts/prepare-human-atlas-europe.py` reads pinned CommonSites (SHA-256 `25fa9ce0915146a00b0957dfda897770758aa7ceb32b81932a252c9b5c20a0f5`) and CommonPhases (SHA-256 `40245b1319b9df3b339042ae5b8b8905533d810af74e39d76f76f31cc33cda96`) tables. The adaptation retains 4,756 geocoded sites and 2,807 phase associations. One phase lacks a matching coordinate and is reported but not mapped. These CommonPhases rows carry culture, subculture, site type, and broad period codes, **not calendar-year bounds**. They are searchable only, with no invented dates on the atlas timeline. The source also publishes radiocarbon determinations, but those have not been calibrated and checked by site context for this layer.

## Pleiades ancient places

`data/pleiades-places.json` adapts the [Pleiades GIS release 4.1](https://github.com/isawnyu/pleiades.datasets/releases/tag/v4.1), copyright Pleiades contributors, **CC BY 3.0** per the [download terms](https://pleiades.stoa.org/downloads). Pinned revision `b6a6790f71c45e4a4ef60fce296c506f28f458bf`; the generated file lists SHA-256 hashes for places, types, locations, and names tables. `scripts/prepare-human-atlas-pleiades.py` selects 21,380 geocoded places in western Eurasia and northern Africa and retains descriptions, place/type identifiers, certain source name variants for search, linked-location accuracy radii, and period associations. Of those, 728 have dated names rather than dated locations; this fallback is identified per record. Representative points may be approximate, including bounding-box centroids. The `archaeologicalRemains` tags are pooled across a place's location rows; they are not dated to the selected year or linked to a specific excavated find. Map dots require certain temporal association and precise representative point. The time map stops using Pleiades associations at 1700 CE because [Modern and later source periods](https://pleiades.stoa.org/vocabularies/time-periods) can date a [modern name for an ancient site](https://pleiades.stoa.org/help/modern-names) or a present location; all records remain searchable as place references. Broad period or terminus bounds do **not** establish continuous settlement, construction dates, or the full extent of a site.

## Language catalog and historical inscriptions

`data/languages.json` derives from [Glottolog 5.3 CLDF](https://glottolog.org/meta/downloads), edited by Hammarström, H., Forkel, R., Haspelmath, M., and Bank, S. (2026), **CC BY 4.0**. Pinned CLDF revision `072ca0d0410039fb8b779be8fc165bac575d2cda`; per-table checksums are embedded in the generated file. `scripts/prepare-human-atlas-languages.py` retains 6,683 geocoded spoken-L1 language records with a published non-extinct AES category and 4,580 family/isolate hierarchy nodes. It excludes extinct historical languages and dialect-only entries from map points. Glottolog gives representative coordinates and classification, not speaker-density polygons or dates of prehistoric speech. The modern catalog appears only at the atlas's 2017 endpoint as a reference, **not** as a 2017 field survey.

`data/language-attestations.json` selects 20 dated, geolocated Latin and Ancient Greek inscriptions from the [Epigraphic Database Heidelberg open dump](https://github.com/epigraphic-database-heidelberg/data), **CC BY-SA 4.0**. Pinned revision `45f166654ab4551a1954617a0df8e56fa7724ccb`; the generated file records the geography-table and every selected TEI XML checksum, EDH ID, source and geography URL, language tag, date label, and findspot. `scripts/prepare-human-atlas-language-attestations.py` extracts and rounds representative coordinates. These dates estimate objects, not language-use lifespans; representative findspots can be city centroids. The selection is illustrative and is not an ancient-language census. The adapted EDH data retain their CC BY-SA terms, separate from the MIT application code.

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
