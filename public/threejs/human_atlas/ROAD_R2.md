# ROAD R2 Pilot

`scripts/prepare-human-atlas-road.py` transforms the locally staged Kandel et al. (2023) reproducibility archive into a small, on-demand ROAD discovery partition. It reads `fig_coverage_temporal/road_coverage_correl.csv`, not the raw dating tables, because that correlation export is the only archive table that directly combines assemblage, locality coordinates, and age bounds.

The source archive is deliberately outside Git. Its expected SHA-256 is pinned in the script. Build the staged objects with:

```sh
python3 scripts/prepare-human-atlas-road.py
```

This writes `tmp/human-atlas-road-r2/v1/manifest.json` and `near-east-50-20ka.json`. The partition is an assemblage-level discovery layer for the geographic working envelope $25$–$60$ E and $20$–$42$ N. It includes supplied age bounds that overlap a deliberately generous 15–55 ka BP context horizon around the intended 50–20 ka BP exploration window.

The archive contains direct dating tables (`table_archaeological_layer_age.csv`, `table_assemblage_age.csv`, and `table_geological_layer_age.csv`), but their rows are individual determinations with method-specific conventional ages and asymmetric errors. They are not joined to the correlation export in a way that supports converting this pilot into calibrated site dates. The pilot consequently retains only the correlation export's `age_min` and `age_max` as source BP bounds. `displayRange` is an atlas placement calculated against 1950 CE; it is not a calibrated interval.

The archive's `road_sources.csv` is a publication list and has no per-assemblage citation key in this export. It also contains no reuse license and the correlation export has no hominin taxon field. The manifest therefore blocks public distribution pending reuse review, and an `human remains` evidence category must not be displayed as a Neanderthal or *Homo sapiens* attribution.

After terms are verified, upload the two immutable objects:

```sh
npx wrangler r2 object put sandbox-miami-storage/human-atlas/road/v1/manifest.json --file tmp/human-atlas-road-r2/v1/manifest.json --content-type application/json
npx wrangler r2 object put sandbox-miami-storage/human-atlas/road/v1/near-east-50-20ka.json --file tmp/human-atlas-road-r2/v1/near-east-50-20ka.json --content-type application/json
```

The intended Worker read endpoint is public and read-only, returning just these allowlisted keys with a long immutable cache policy. Do not expose an arbitrary R2 key parameter.

## Full Explorer

Build the full mappable correlation export into geographic discovery partitions:

```sh
python3 scripts/prepare-human-atlas-road.py --scope full --output tmp/human-atlas-road-r2/full-v1
```

The generated manifest contains SHA-256 checksums and counts for `central-asia`, `europe`, `north-africa`, `other`, and `west-asia`. Every record requires coordinates and supplied `age_min` / `age_max` values; no period, taxon, or geographic relevance filter removes records before partitioning. `displayCategory` selects a single map marker while `evidenceCategory` preserves the source's full category text. `hasHumanRemainsCategory` is only a filter convenience and does not infer taxon.

The full generated set is about 7.1 MB and is bundled under `public/threejs/human_atlas/data/road/v1/`. The Explorer loads either one geographic partition or all partitions in parallel from these static assets. The R2 endpoint remains available as a read-only delivery option, but it is not required by the Atlas.

After the reuse review, upload every generated JSON object under the manifest's keys. The Worker only serves this fixed allowlist:

```text
GET /api/human-atlas/road
GET /api/human-atlas/road?partition=west-asia
```

Responses are public and immutable. The endpoint rejects unknown partition IDs and never accepts a raw R2 object key.