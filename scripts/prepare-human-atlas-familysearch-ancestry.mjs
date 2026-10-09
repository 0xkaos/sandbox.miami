#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const input = resolve(root, process.argv[2] ?? 'ancestors.ged');
const output = resolve(root, process.argv[3] ?? 'private/familysearch-ancestry.json');
const rootId = process.argv[4] ?? '@I1@';
const overridesFile = resolve(root, process.argv[5] ?? 'private/familysearch-overrides.json');

function parseYear(date = '') {
  const years = [...date.matchAll(/\b(\d{3,4})\b/g)].map(match => Number(match[1])).filter(year => year >= 1 && year <= 3000);
  if (!years.length) return null;
  return { year: Math.round((Math.min(...years) + Math.max(...years)) / 2), range: [Math.min(...years), Math.max(...years)] };
}

function parseCoordinate(value = '') {
  const match = value.trim().match(/^([NSWE])?\s*(-?\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const [, direction, number] = match;
  if (!direction) return Number(number);
  const sign = direction && 'SW'.includes(direction.toUpperCase()) ? -1 : 1;
  return sign * Math.abs(Number(number));
}

const people = new Map();
const families = new Map();
let individual = null;
let family = null;
let event = null;

function finishEvent() {
  if (!individual || !event || event.type !== 'BIRT') return;
  const date = parseYear(event.date);
  if (!date) return;
  individual.birth = { ...date, dateText: event.date ?? null, place: event.place ?? null,
    lat: Number.isFinite(event.lat) ? event.lat : null, lon: Number.isFinite(event.lon) ? event.lon : null,
    coordinateSource: Number.isFinite(event.lat) && Number.isFinite(event.lon) ? 'GEDCOM MAP' : null };
}

const lines = createInterface({ input: createReadStream(input, { encoding: 'utf8' }) });
for await (const line of lines) {
  const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?:\s+(.*))?$/);
  if (!match) continue;
  const [, level, pointer, tag, value = ''] = match;
  if (level === '0') {
    finishEvent(); event = null; individual = null; family = null;
    if (tag === 'INDI') { individual = { id: pointer, name: 'Name not recorded', sex: null, parents: [], birth: null }; people.set(pointer, individual); }
    if (tag === 'FAM') { family = { id: pointer, parents: [], children: [] }; families.set(pointer, family); }
    continue;
  }
  if (individual) {
    if (level === '1') {
      finishEvent(); event = tag === 'BIRT' ? { type: 'BIRT' } : null;
      if (tag === 'NAME') individual.name = value.replaceAll('/', '').replace(/\s+/g, ' ').trim() || individual.name;
      if (tag === 'SEX') individual.sex = value || null;
      if (tag === 'FAMC') individual.parents.push(value);
      if (tag === '_FSFTID') individual.familySearchId = value;
    } else if (event) {
      if (level === '2' && tag === 'DATE') event.date = value;
      if (level === '2' && tag === 'PLAC') event.place = value;
      if (level === '4' && tag === 'LATI') event.lat = parseCoordinate(value);
      if (level === '4' && tag === 'LONG') event.lon = parseCoordinate(value);
    }
  } else if (family && level === '1') {
    if (tag === 'HUSB' || tag === 'WIFE') family.parents.push(value);
    if (tag === 'CHIL') family.children.push(value);
  }
}
finishEvent();
let overrides = {};
try { overrides = JSON.parse(await readFile(overridesFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const [id, override] of Object.entries(overrides)) {
  if (!people.has(id) || !override.birth) continue;
  const { dateText, year, range, place, lat, lon } = override.birth;
  if (!Number.isFinite(year) || !Array.isArray(range) || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Invalid local birth override for ${id}`);
  people.get(id).birth = { dateText, year, range, place, lat, lon, coordinateSource: 'local user-provided override' };
}

const parentsFor = id => [...new Set((people.get(id)?.parents ?? []).flatMap(familyId => families.get(familyId)?.parents ?? []).filter(parentId => people.has(parentId)))];
const ancestors = new Map([[rootId, { depth: 0 }]]);
const nextTowardRootById = {};
const queue = [rootId];
while (queue.length) {
  const childId = queue.shift(), child = ancestors.get(childId);
  for (const parentId of parentsFor(childId)) {
    const next = { depth: child.depth + 1 };
    const existing = ancestors.get(parentId);
    if (!existing || next.depth < existing.depth) { ancestors.set(parentId, next); nextTowardRootById[parentId] = childId; queue.push(parentId); }
  }
}

const individuals = [...ancestors].map(([id, lineage]) => {
  const person = people.get(id);
  return { id, name: person.name, sex: person.sex, familySearchId: person.familySearchId ?? null,
    birth: person.birth, depth: lineage.depth };
}).sort((a, b) => (a.birth?.year ?? Infinity) - (b.birth?.year ?? Infinity) || a.name.localeCompare(b.name));
const mappedBirths = individuals.filter(person => person.birth?.year && Number.isFinite(person.birth.lat) && Number.isFinite(person.birth.lon));

const catalog = {
  schemaVersion: 3,
  source: { label: 'Personal FamilySearch GEDCOM export', generatedAt: new Date().toISOString(), coordinateMethod: 'GEDCOM MAP coordinates only', caveat: 'Personal research visualization. Names, relationships, dates, places, and coordinates are transcribed from an unverified FamilySearch-derived GEDCOM export; they are not independent historical evidence.' },
  rootId,
  counts: { parsedIndividuals: people.size, ancestorIndividuals: ancestors.size, mappedBirths: mappedBirths.length },
  parentIdsById: Object.fromEntries([...ancestors.keys()].map(id => [id, parentsFor(id)])),
  nextTowardRootById,
  individuals,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog)}\n`);
console.log(`Wrote ${catalog.counts.mappedBirths} mapped ancestor births from ${catalog.counts.ancestorIndividuals} ancestor records to ${output}`);