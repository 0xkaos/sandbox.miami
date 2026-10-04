#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
output <- if (length(args)) args[[1]] else 'public/threejs/human_atlas/data/road-neanderthal-localities.json'
species_output <- file.path(dirname(output), 'road-human-remains-species.json')

if (!requireNamespace('roadDB', quietly = TRUE) || !requireNamespace('jsonlite', quietly = TRUE)) {
  stop('Install roadDB and jsonlite before generating the ROAD Neanderthal catalog.')
}

remains <- roadDB::road_get_human_remains(human_species = 'neanderthalensis')
if (!nrow(remains)) stop('ROAD returned no explicit neanderthalensis records.')
all_remains <- roadDB::road_get_human_remains()

display_year <- function(age_bp) 1950 - age_bp
number_or_null <- function(value) if (is.finite(value)) value else NULL
records <- lapply(split(remains, remains$locality_id), function(rows) {
  dated <- rows[is.finite(rows$age_min) & is.finite(rows$age_max), ]
  list(
    id = paste0('road-neanderthal-', gsub('[^a-z0-9]+', '-', tolower(iconv(rows$locality_id[[1]], to = 'ASCII//TRANSLIT')))),
    locality = rows$locality_id[[1]],
    country = rows$country[[1]],
    localityType = rows$locality_type[[1]],
    lat = number_or_null(rows$coord_y[[1]]),
    lon = number_or_null(rows$coord_x[[1]]),
    explicitHumanRemains = length(unique(rows$human_remains_id)),
    assemblages = I(sort(unique(rows$assemblage_name))),
    archaeologicalLayers = I(sort(unique(stats::na.omit(unlist(strsplit(rows$archlayer, ', ')))))),
    suppliedAgeRangeBP = if (nrow(dated)) c(min(dated$age_min), max(dated$age_max)) else NA_real_,
    displayRange = if (nrow(dated)) c(display_year(max(dated$age_max)), display_year(min(dated$age_min))) else NA_real_
  )
})

catalog <- list(
  schemaVersion = 1,
  source = list(
    dataset = 'ROCEEH Out of Africa Database (ROAD)',
    access = 'roadDB 0.2.0 live query',
    query = "road_get_human_remains(human_species = 'neanderthalensis')",
    retrieved = format(Sys.time(), tz = 'UTC', usetz = TRUE),
    interpretation = 'Each record is a ROAD locality with one or more human-remains rows explicitly classified as Homo neanderthalensis in ROAD. Archaeological layers and supplied age bounds are ROAD database fields. displayRange places supplied BP bounds on the atlas axis using 1950 CE as BP zero; it is not a calibrated date. A locality marker does not establish continuous occupation, a culture boundary, ancestry, language, or population.'
  ),
  records = unname(records)
)

dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
jsonlite::write_json(catalog, output, auto_unbox = TRUE, pretty = FALSE)
species_records <- lapply(split(all_remains, all_remains$locality_id), function(rows) list(
  locality = rows$locality_id[[1]],
  lat = number_or_null(rows$coord_y[[1]]),
  lon = number_or_null(rows$coord_x[[1]]),
  humanRemains = length(unique(rows$human_remains_id)),
  humanSpecies = I(sort(unique(stats::na.omit(rows$species))))
))
species_catalog <- list(
  schemaVersion = 1,
  source = list(
    dataset = 'ROCEEH Out of Africa Database (ROAD)',
    access = 'roadDB 0.2.0 live query',
    query = 'road_get_human_remains()',
    retrieved = format(Sys.time(), tz = 'UTC', usetz = TRUE),
    interpretation = 'Species terms are verbatim ROAD human-remains classifications aggregated by locality. They do not identify the taxon of every assemblage observation at that locality, and absent terms do not establish absence of a taxon.'
  ),
  records = unname(species_records)
)
jsonlite::write_json(species_catalog, species_output, auto_unbox = TRUE, pretty = FALSE)
message('Wrote ', length(records), ' explicit ROAD Neanderthal localities to ', output, ' and ', length(species_records), ' locality species records to ', species_output)