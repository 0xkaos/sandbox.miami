#!/usr/bin/env Rscript

# Build a lazy-loaded, independently calibrated P3K14C evidence catalog.
suppressPackageStartupMessages(library(Bchron))

root <- normalizePath(file.path(dirname(sub('^--file=', '', commandArgs(trailingOnly = FALSE)[grep('^--file=', commandArgs(trailingOnly = FALSE))][1])), '..'))
url <- 'https://www.p3k14c.org/data/p3k14c_2022.06.csv'
cache <- '/tmp/human-atlas-research/p3k14c_2022.06.csv'
output <- file.path(root, 'public', 'threejs', 'human_atlas', 'data', 'p3k14c-calibrated-dates.json')

if (!file.exists(cache)) {
  dir.create(dirname(cache), recursive = TRUE, showWarnings = FALSE)
  download.file(url, cache, mode = 'wb', quiet = TRUE)
}
source_sha256 <- strsplit(system2('sha256sum', cache, stdout = TRUE)[1], '\\s+')[[1]][1]
dates <- utils::read.csv(cache, stringsAsFactors = FALSE, check.names = FALSE)

calendar_year <- function(cal_bp) 1950 - cal_bp
optional_text <- function(value) {
  value <- trimws(as.character(value))
  if (is.na(value) || !nzchar(value)) NULL else value
}
material_class <- function(material) {
  value <- tolower(trimws(ifelse(is.na(material), '', material)))
  if (grepl('human', value)) return('human')
  if (grepl('charcoal|wood|plant|seed|grain|nut|reed|straw', value)) return('plant')
  if (grepl('bone|tooth|dentin|antler|ivory|collagen', value)) return('faunal')
  if (grepl('shell|mollusc|marine', value)) return('shell')
  if (!nzchar(value)) return('unspecified')
  'other'
}
hdr_result <- function(calibration, probability = .954) {
  masses <- calibration$densities / sum(calibration$densities)
  ordered <- order(masses, decreasing = TRUE)
  selected <- rep(FALSE, length(masses))
  selected[ordered[cumsum(masses[ordered]) <= probability]] <- TRUE
  if (!any(selected)) selected[ordered[1]] <- TRUE
  first_excluded <- ordered[which(cumsum(masses[ordered]) > probability)[1]]
  if (!is.na(first_excluded)) selected[first_excluded] <- TRUE
  chosen <- which(selected)
  breaks <- c(0, which(diff(chosen) > 1), length(chosen))
  list(ranges = unname(t(vapply(seq_len(length(breaks) - 1), function(index) {
    selected_range <- chosen[(breaks[index] + 1):breaks[index + 1]]
    as.integer(round(c(calendar_year(calibration$ageGrid[max(selected_range)]), calendar_year(calibration$ageGrid[min(selected_range)]))))
  }, integer(2)))), probability = sum(masses[selected]))
}

valid <- with(dates, is.finite(Age) & is.finite(Error) & Error > 0 & is.finite(Lat) & is.finite(Long)
  & abs(Lat) <= 90 & abs(Long) <= 180 & Age >= 95 & Age <= 50193)
dates <- dates[valid, ]
if (!nrow(dates)) stop('No P3K14C records can be calibrated with IntCal20.')

# Bchron accepts vectors, but chunking bounds memory and makes long runs observable.
records <- vector('list', nrow(dates))
for (start in seq(1, nrow(dates), by = 500)) {
  indexes <- start:min(start + 499, nrow(dates))
  rows <- dates[indexes, ]
  calibrations <- BchronCalibrate(rows$Age, rows$Error, rep('intcal20', nrow(rows)), sprintf('p3k14c-%d', indexes))
  for (offset in seq_along(indexes)) {
    row <- rows[offset, ]; interval <- hdr_result(calibrations[[offset]])
    records[[indexes[offset]]] <- list(
      id = sprintf('p3k14c-%06d', indexes[offset]), site = if (nzchar(row$SiteName)) row$SiteName else row$LabID,
      labId = row$LabID, lat = round(row$Lat, 6), lon = round(row$Long, 6),
      country = optional_text(row$Country), continent = optional_text(row$Continent),
      locationAccuracy = as.integer(row$LocAccuracy), material = optional_text(row$Material), materialClass = material_class(row$Material),
      taxa = optional_text(row$Taxa), method = optional_text(row$Method),
      source = optional_text(row$Source), reference = optional_text(row$Reference),
      radiocarbonBP = as.integer(row$Age), radiocarbonSd = as.integer(row$Error),
      calibrationCurve = 'IntCal20', calibrationMethod = 'BchronCalibrate', calibratedProbability = interval$probability, calibratedRanges95 = interval$ranges
    )
  }
  message(sprintf('Calibrated %d/%d P3K14C rows', max(indexes), nrow(dates)))
}

result <- list(schemaVersion = 1, source = list(
  dataset = 'P3K14C', version = '2022.06', title = 'PEOPLE 3000 Radiocarbon Database', url = url,
  sha256 = source_sha256, license = 'CC0 1.0 (attribution requested)', inputRows = nrow(dates),
  calibration = 'Each retained P3K14C radiocarbon determination was independently calibrated with Bchron and IntCal20. calibratedRanges95 contains all target-95.4% highest-density calendar intervals. IntCal20 support limits this catalog to conventional radiocarbon ages from 95 to 50,193 BP. Coordinates with locationAccuracy below 3 are approximate; P3K14C deliberately obfuscates United States and Canadian coordinates to administrative centroids.'
), records = records)
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
writeLines(jsonlite::toJSON(result, auto_unbox = TRUE, null = 'null', digits = NA), output, useBytes = TRUE)
message(sprintf('P3K14C: %d dates written to %s', length(records), output))