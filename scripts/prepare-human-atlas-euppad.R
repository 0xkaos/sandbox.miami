#!/usr/bin/env Rscript

# Build independently calibrated EUPPAD selected radiocarbon evidence.
# Each source row is calibrated separately with Bchron 4.7.8 and IntCal20.

suppressPackageStartupMessages(library(Bchron))

script_path <- sub('^--file=', '', commandArgs(trailingOnly = FALSE)[grep('^--file=', commandArgs(trailingOnly = FALSE))][1])
root <- normalizePath(file.path(dirname(script_path), '..'))
output <- file.path(root, 'public', 'threejs', 'human_atlas', 'data', 'euppad-calibrated-dates.json')
cache <- '/tmp/human-atlas-research/EUPPAD_data.zip'
url <- 'https://zenodo.org/records/19930467/files/EUPPAD_data.zip?download=1'
sha256 <- '53f0f1dfd198b4e8a065254b74337faf14e377b559bb09186f09dd5ddee65f46'
md5 <- '4fb11e02f5079f6484f4949e4194c174'
csv_name <- 'EUPPAD_data/Radiocarbon dates/euppad_radiocarbon_dates_selected.csv'

if (!file.exists(cache)) {
  dir.create(dirname(cache), recursive = TRUE, showWarnings = FALSE)
  download.file(url, cache, mode = 'wb', quiet = TRUE)
}
if (unname(tools::md5sum(cache)) != md5) stop('EUPPAD archive MD5 changed')
if (strsplit(system2('sha256sum', cache, stdout = TRUE)[1], '\\s+')[[1]][1] != sha256) stop('EUPPAD archive SHA-256 changed')

scratch <- tempfile('euppad-')
dir.create(scratch)
on.exit(unlink(scratch, recursive = TRUE), add = TRUE)
utils::unzip(cache, files = csv_name, exdir = scratch)
dates <- utils::read.csv(file.path(scratch, csv_name), sep = ';', quote = '"', stringsAsFactors = FALSE, check.names = FALSE)
names(dates) <- trimws(names(dates))

json_value <- function(value) {
  if (is.na(value) || !nzchar(value)) NULL else value
}
calendar_year <- function(cal_bp) 1950 - cal_bp
posterior_median <- function(calibration) {
  cdf <- cumsum(calibration$densities) / sum(calibration$densities)
  calibration$ageGrid[which(cdf >= 0.5)[1]]
}
hdr_result <- function(calibration, probability = 0.954) {
  masses <- calibration$densities / sum(calibration$densities)
  order_by_density <- order(masses, decreasing = TRUE)
  selected <- rep(FALSE, length(masses))
  selected[order_by_density[cumsum(masses[order_by_density]) <= probability]] <- TRUE
  if (!any(selected)) selected[order_by_density[1]] <- TRUE
  first_excluded <- order_by_density[which(cumsum(masses[order_by_density]) > probability)[1]]
  if (!is.na(first_excluded)) selected[first_excluded] <- TRUE
  chosen <- which(selected)
  breaks <- c(0, which(diff(chosen) > 1), length(chosen))
  intervals <- t(vapply(seq_len(length(breaks) - 1), function(index) {
    range <- chosen[(breaks[index] + 1):breaks[index + 1]]
    as.integer(round(c(calendar_year(calibration$ageGrid[max(range)]), calendar_year(calibration$ageGrid[min(range)]))))
  }, integer(2)))
  list(ranges = unname(intervals), probability = sum(masses[selected]))
}

records <- vector('list', nrow(dates))
for (index in seq_len(nrow(dates))) {
  row <- dates[index, ]
  age <- as.numeric(row$c14age)
  age_sd <- as.numeric(row$c14std)
  if (!is.finite(age) || !is.finite(age_sd) || age_sd <= 0 || !is.finite(as.numeric(row$lat)) || !is.finite(as.numeric(row$lon))) stop(sprintf('Invalid selected EUPPAD row %d', index))
  calibration <- BchronCalibrate(ages = age, ageSds = age_sd, calCurves = 'intcal20', ids = sprintf('euppad-%d', index))[[1]]
  interval_result <- hdr_result(calibration)
  records[[index]] <- list(
    id = sprintf('euppad-%03d', index), siteId = row$EUPPAD_id, site = row$site,
    lat = round(as.numeric(row$lat), 6), lon = round(as.numeric(row$lon), 6),
    method = json_value(row$method), labId = json_value(row$labnr),
    radiocarbonBP = age, radiocarbonSd = age_sd,
    material = json_value(row$material), feature = json_value(row$feature), references = json_value(row$references),
    calibrationCurve = 'IntCal20', calibrationMethod = 'BchronCalibrate',
    calibratedMedianBP = as.integer(round(posterior_median(calibration))),
    calibratedProbability = interval_result$probability,
    calibratedRanges95 = interval_result$ranges
  )
}

result <- list(
  schemaVersion = 1,
  source = list(
    dataset = 'EUPPAD', version = 'v1', authors = 'Böckenförde (2026)',
    title = 'The European Upper Palaeolithic Palaeoecological and Archaeological Dataset for sites north of 50°N',
    doi = 'https://doi.org/10.5281/zenodo.19930467', url = url,
    sha256 = sha256, md5 = md5, license = 'CC BY 4.0',
    inputTable = 'euppad_radiocarbon_dates_selected.csv', inputRows = nrow(dates),
    calibration = 'Each selected source row was independently calibrated with Bchron 4.7.8 and IntCal20. calibratedRanges95 contains all target-95.4% highest-density calendar intervals, expressed as atlas calendar years; calibratedProbability records the discrete coverage returned by Bchron. Multi-modal intervals are retained. A calibrated date is evidence for that dated sample, not continuous occupation, a culture boundary, ancestry, language, or population.'
  ),
  records = records
)

json <- jsonlite::toJSON(result, auto_unbox = TRUE, null = 'null', digits = NA)
writeLines(json, output, useBytes = TRUE)
cat(sprintf('EUPPAD: %d selected dates calibrated with Bchron / IntCal20; %s bytes\n', length(records), format(file.info(output)$size, big.mark = ',')))