# Review of the suggested datasets

Inspected **2026-09-29**, including repository files and actual downloadable CSVs. These are research candidates in **Sources & methods**; their claims have not been merged wholesale into the population or event layers.

| Source | Actual contents inspected | Best use | Work before map integration |
| --- | --- | --- | --- |
| [TimelineConsortium / Timeline-Data](https://github.com/TimelineConsortium/Timeline-Data) | Example JSON/CSV timelines. `empires.json`: 34 records. `epidemics.json`: 190 records. Also philosophers, authors, wine history, and a Black Sea colonies network. | Empire durations, epidemic leads, intellectual-history context; the colony network is particularly relevant to Mediterranean movement. | Verify dates against cited research, distinguish empire lifespans from geographic extents, add coordinates, and establish redistribution terms. |
| [Nate McMaster / History Explorer](https://github.com/natemcmaster/historyexplorer) | `public/data.json`: 415 nodes plus 415 adjacency entries. Nodes have titles, descriptions, Wikipedia URLs, and optional images. No structured year or latitude/longitude fields. | A related-people/ideas/places graph attached to an inspector. | Resolve dates and places from independent evidence. Preserve source attribution. Do not turn a conceptual link into a migration or a causal historical claim. |
| [History of Conflicts](https://www.kaggle.com/datasets/ramjasmaurya/conflicts-among-nations) | 927 rows: Date, Headline, Conflict Type, Country, Region, Description, Sources. No coordinate columns. Much of the collection concerns water as a weapon, trigger, or casualty. | A specialized water-conflict layer, preferably from the original chronology. | Date-range parsing, explicit myth/history classification, geocoding with location precision, duplicate review, upstream attribution and terms. |
| [World Important Events – Ancient to Modern](https://www.kaggle.com/datasets/saketk511/world-important-events-ancient-to-modern) | Version 7, 1,096 rows with incident names, dates, country/place names, categories, impact, affected-population prose, people, and outcome. No citation or coordinate fields. | A broad list of topics to research and independently source. | Verify every retained event, repair text, deduplicate, geocode, and replace subjective outcome labels with factual descriptions. |

## Findings that affect interpretation

### Timeline-Data

Empire records provide **time intervals and broad region labels**, not border polygons. For example, a single Roman Empire interval cannot represent republican expansion, the empire's changing frontiers, or continuity in the east. The epidemic file uses broad region facets and inconsistent precision in `content_text`; it is not an epidemiological map.

No LICENSE file was present in the inspected repository tree, and GitHub's repository metadata returned no recognized license. That is a reuse question to resolve before copying the collection. Existing independently sourced atlas events can still use the tables as research leads. The app does not redistribute these records.

### History Explorer

The README explains that builder scripts collected Wikipedia material and provided a way to review and link it. The repository code license is **GPL-2.0**. Wikipedia-derived descriptions and images have their own attribution/licensing histories; the repository code license is not blanket permission for all content. Dates cannot safely be guessed from article prose or relationships.

The current graph is useful for discovery and context, but not a chronological or geospatial dataset as supplied. Counts above describe graph structure, not 415 independently dated historical events.

### Conflicts

The Kaggle uploader labels the collection **CC0: Public Domain**. Its opening examples and source references match the [Pacific Institute Water Conflict Chronology](https://www.worldwater.org/water-conflict/) lineage. This is an inference from the records; the Kaggle title alone does not establish its origin or completeness.

The first entry concerns a **Sumerian religious narrative**, not a measured flood or a documented interstate battle. The [older Pacific Institute chronology](https://worldwater.org/wp-content/uploads/2013/07/ww8-red-water-conflict-chronology-2014.pdf) explicitly categorized that account as religious. That distinction should survive an import.

All 927 inspected rows have a nonempty source string, which is promising, but many strings require bibliographic resolution. Four country fields are unknown. Country and region names are insufficient to locate a point accurately. The data are heavily concentrated in recent decades; they should not become a proxy for all warfare or its historical frequency.

Prefer the **upstream Water Conflict Chronology** for current records, location metadata, and [methods](https://www.worldwater.org/definitions-methods-sources/). Its [current licensing page](https://www.worldwater.org/data-licensing-and-commercial-use/) needs to govern upstream reuse; an uploader's CC0 label does not establish ownership of all mirrored content.

### World Important Events

The Kaggle API lists the license as **Database: Open Database, Contents: Database Contents**. Preserve the specific database/content terms when deriving a distributable collection.

Observed quality issues:

- 66 rows repeat an incident name after lowercasing and trimming; this is a review queue, not proof that every repetition is a duplicate event.
- 453 day-of-month fields are blank or “Unknown.” Approximate-year precision is appropriate for many ancient records and should be preserved, not replaced by January 1.
- Some name strings contain inserted “Unknown” fragments. These require verification rather than a universal string replacement.
- There is **no citation field**. A polished description is not evidence that its date or interpretation is correct.
- `Affected Population` is prose such as a group name, not a numeric population estimate. It cannot feed the spikes.
- `Outcome` classifies events as Positive, Negative, Mixed, or Ongoing. Those labels express a perspective and are not used in the atlas.
- Modern country labels can project present-day borders backward, and ancient place names need historical gazetteer resolution.

## How these can be brought in

Keep original record IDs, raw dates, original labels, source URLs, licenses, and a review status in an intermediate research file. Establish a date interval and geographic precision separately. An uncertain location can become an area or an unplaced record rather than an arbitrary modern capital.

For an initial curated import, choose a small set of events, verify their primary or scholarly references, and create a research JSON file using the [atlas format](README.md#local-research-format). The current importer handles sourced events and qualitative routes, validates all records before adding any, and keeps them local to the current tab. Bulk candidate data should remain distinguishable from curated evidence.
