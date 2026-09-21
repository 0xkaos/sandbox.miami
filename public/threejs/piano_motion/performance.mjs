export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function lowerBound(items, value, key = 'time') {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (items[mid][key] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function validateMidi(bytes) {
  if (bytes.length < 14 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'MThd') {
    throw new Error('Choose a Standard MIDI file (.mid or .midi).');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4) !== 6) throw new Error('This MIDI header is not supported. Export a standard Type 0 or Type 1 MIDI file.');
  if (view.getUint16(8) > 1) throw new Error('Type 2 MIDI contains independent songs. Export a Type 0 or Type 1 file.');
  if (view.getUint16(12) & 0x8000) throw new Error('SMPTE timecode MIDI is not supported. Export MIDI using beats and tempo.');
  if (!view.getUint16(12)) throw new Error('The MIDI file has an invalid beat resolution.');
}

export function trackOptions(midi) {
  return midi.tracks.flatMap((track, index) => track.notes.length ? [{
    id: index, name: track.name || `Track ${index + 1}`, count: track.notes.length,
    instrument: track.instrument.name, percussion: track.instrument.percussion,
    piano: !track.instrument.percussion && track.instrument.number < 8,
  }] : []);
}

// Reproducible variation means replay, seeking, and the visual score agree.
function noise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

export function defaultTrackHands(midi) {
  const hands = new Map();
  for (const { id, name } of trackOptions(midi)) {
    if (/\b(left(?:\s+hand)?|l\.?h\.?|bass)\b/i.test(name)) hands.set(id, 'left');
    else if (/\b(right(?:\s+hand)?|r\.?h\.?|treble)\b/i.test(name)) hands.set(id, 'right');
  }
  return hands;
}

// A suggested split for unlabelled, combined tracks. It is editable because MIDI does not encode hands.
export function suggestHandSplit(midi) {
  const pitches = midi.tracks.filter(track => !track.instrument.percussion).flatMap(track => track.notes.map(note => note.midi));
  if (!pitches.length) return 60;
  let low = 48, high = 76;
  for (let pass = 0; pass < 12; pass++) {
    const split = (low + high) / 2;
    let left = 0, right = 0, leftCount = 0, rightCount = 0;
    for (const pitch of pitches) {
      if (pitch < split) { left += pitch; leftCount++; }
      else { right += pitch; rightCount++; }
    }
    if (!leftCount || !rightCount) return 60;
    low = left / leftCount; high = right / rightCount;
  }
  return clamp(Math.round((low + high) / 2), 48, 72);
}

export function compilePerformance(midi, selected, expression = 0, { handSplit = 60, trackHands = defaultTrackHands(midi) } = {}) {
  const channels = new Set([...selected].map(id => midi.tracks[id].channel));
  const raw = [];
  for (const id of selected) {
    midi.tracks[id].notes.forEach((note, index) => {
      if (![note.time, note.duration, note.velocity, note.midi].every(Number.isFinite)) return;
      const delay = expression * (0.008 * noise(note.ticks) + 0.003 * noise(index + id * 71));
      raw.push({ id: `${id}:${index}`, track: id, channel: midi.tracks[id].channel,
        hand: ['left', 'right'].includes(trackHands.get(id)) ? trackHands.get(id) : note.midi < handSplit ? 'left' : 'right',
        midi: note.midi, ticks: note.ticks, durationTicks: note.durationTicks,
        time: Math.max(0, note.time + delay), keyEnd: Math.max(0, note.time + delay) + Math.max(0.025, note.duration),
        velocity: clamp(note.velocity * (1 + expression * 0.09 * noise(index + note.midi)), 0.01, 1),
      });
    });
  }
  if (raw.length > 20000) throw new Error('Select fewer tracks: this study supports up to 20,000 notes at a time.');
  raw.sort((a, b) => a.time - b.time || a.midi - b.midi);
  const lastKey = raw.reduce((end, note) => Math.max(end, note.keyEnd), 0);
  const intervals = new Map();
  const pedals = [];
  for (const channel of channels) {
    // Controller-only tracks can carry pedal data for a separate note track.
    const events = midi.tracks.filter(track => track.channel === channel)
      .flatMap(track => track.controlChanges[64] || []).sort((a, b) => a.time - b.time);
    const spans = [];
    let down = null;
    for (const event of events) {
      if (event.value >= 0.5 && down === null) {
        down = event.time;
        pedals.push({ time: event.time, down: true, channel });
      } else if (event.value < 0.5 && down !== null) {
        spans.push({ time: down, end: event.time });
        pedals.push({ time: event.time, down: false, channel });
        down = null;
      }
    }
    if (down !== null) {
      const end = Math.max(down + 0.1, lastKey + 0.8);
      spans.push({ time: down, end });
      pedals.push({ time: end, down: false, channel });
    }
    intervals.set(channel, spans);
  }
  for (const note of raw) {
    const spans = intervals.get(note.channel);
    const i = lowerBound(spans, note.keyEnd + 1e-7) - 1;
    const span = spans[i];
    note.end = span && span.end > note.keyEnd ? span.end : note.keyEnd;
    note.beat = note.ticks / midi.header.ppq;
  }
  pedals.sort((a, b) => a.time - b.time);
  const end = raw.reduce((value, note) => Math.max(value, note.end), 0);
  // Independent hand timelines: outer chord voices provide stable landing points.
  const guides = { left: [], right: [] };
  for (const note of raw) {
    const guide = guides[note.hand];
    const previous = guide.at(-1);
    if (previous && note.time - previous.time < 0.045) {
      const outer = note.hand === 'right' ? note.midi > previous.midi : note.midi < previous.midi;
      const keyEnd = Math.max(previous.keyEnd, note.keyEnd);
      const end = Math.max(previous.end, note.end);
      if (outer) guide[guide.length - 1] = { ...note, time: previous.time, keyEnd, end };
      else { previous.keyEnd = keyEnd; previous.end = end; }
    } else guide.push({ ...note });
  }
  return { notes: raw, pedals, intervals, guides, duration: end + 2.5,
    header: midi.header, bars: makeBars(midi.header, raw), end };
}

function makeBars(header, notes) {
  const lastTick = notes.reduce((end, note) => Math.max(end, note.ticks + note.durationTicks), header.ppq * 4);
  const meters = [{ ticks: 0, timeSignature: [4, 4] }, ...header.timeSignatures];
  const byTick = [...new Map(meters.map(meter => [meter.ticks, meter])).values()].sort((a, b) => a.ticks - b.ticks);
  const bars = [];
  let tick = 0, meterIndex = 0;
  while (tick <= lastTick + header.ppq * 8 && bars.length < 10000) {
    while (byTick[meterIndex + 1]?.ticks <= tick) meterIndex++;
    const signature = byTick[meterIndex].timeSignature;
    bars.push({ beat: tick / header.ppq, number: bars.length + 1, signature });
    const next = tick + header.ppq * signature[0] * 4 / signature[1];
    tick = Math.min(next, byTick[meterIndex + 1]?.ticks ?? Infinity);
    if (!Number.isFinite(tick) || next <= bars.at(-1).beat * header.ppq) break;
  }
  return bars;
}

export function sampleFor(note, layers = 16) {
  const root = clamp(Math.round((note.midi - 21) / 3) * 3 + 21, 21, 108);
  const available = layers === 4 ? [3, 7, 11, 15] : Array.from({ length: 16 }, (_, i) => i + 1);
  const target = clamp(Math.ceil(note.velocity * 16), 1, 16);
  const layer = available.reduce((best, current) => Math.abs(current - target) < Math.abs(best - target) ? current : best);
  const name = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'][root % 12] + (Math.floor(root / 12) - 1);
  return { key: `${name}v${layer}`, root, layer, rate: 2 ** ((note.midi - root) / 12) };
}

export function notePosition(midi, hand) {
  const degree = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][midi % 12];
  const diatonic = Math.floor(midi / 12) * 7 + degree;
  const treble = hand ? hand === 'right' : midi >= 60;
  return { y: treble ? 1.05 + (diatonic - 37) * 0.24 : -2.65 + (diatonic - 25) * 0.24,
    sharp: [1, 3, 6, 8, 10].includes(midi % 12), treble };
}

export function handGuidePose(guide, time, spacing, reduced = false) {
  if (!guide.length) return null;
  const nextIndex = lowerBound(guide, time + 1e-7);
  const a = guide[Math.max(0, nextIndex - 1)], b = guide[Math.min(guide.length - 1, nextIndex)];
  const from = notePosition(a.midi, a.hand), to = notePosition(b.midi, b.hand);
  const gap = b.time - a.time;
  let fraction = clamp((time - a.time) / Math.max(0.01, gap), 0, 1);
  let opacity = 1;
  if (time < a.time) opacity = clamp(1 - (a.time - time) / 0.4, 0, 1);
  else if (a === b) opacity = clamp(1 - (time - a.keyEnd) / 0.4, 0, 1);
  else if (b.time - a.keyEnd > 0.9) {
    // Rest at the last key, fade away, and approach the next entrance near its onset.
    if (time < b.time - 0.55) {
      fraction = 0;
      opacity = clamp(1 - (time - a.keyEnd) / 0.35, 0, 1);
    } else {
      const approach = clamp((time - (b.time - 0.55)) / 0.55, 0, 1);
      return { x: b.beat * spacing - spacing * (1 - approach), y: to.y,
        z: 0.32 + (reduced ? 0 : Math.sin(approach * Math.PI) * 0.85), opacity: approach };
    }
  }
  return { x: (a.beat + (b.beat - a.beat) * fraction) * spacing,
    y: from.y + (to.y - from.y) * fraction,
    z: 0.32 + (reduced ? 0 : Math.sin(fraction * Math.PI) * Math.min(3.8, 0.4 + gap * 1.5)), opacity };
}

export function createDemo(Midi) {
  const midi = new Midi();
  midi.header.name = 'After the rain';
  midi.header.tempos = [{ ticks: 0, bpm: 76 }, { ticks: 11520, bpm: 72 }, { ticks: 28800, bpm: 68 }];
  midi.header.timeSignatures = [{ ticks: 0, timeSignature: [6, 8] }];
  midi.header.update();
  const right = midi.addTrack(), left = midi.addTrack();
  right.name = 'Right hand'; left.name = 'Left hand';
  right.channel = 0; left.channel = 0;
  const chords = [[45, 52, 57], [41, 48, 53], [48, 55, 60], [43, 50, 55],
    [45, 52, 57], [41, 48, 53], [38, 45, 53], [40, 47, 56]];
  const phrases = [[76, 72, 71, 69], [72, 69, 67, 65], [67, 72, 76, 79], [74, 71, 69, 67],
    [76, 81, 79, 76], [77, 76, 72, 69], [74, 72, 69, 65], [71, 68, 64, 68]];
  const ppq = midi.header.ppq;
  for (let bar = 0; bar < 24; bar++) {
    const chord = chords[bar % 8], phrase = phrases[bar % 8];
    const start = bar * 3 * ppq;
    const swell = 0.05 * Math.sin(bar / 3);
    [0, 1, 2, 1, 2, 1].forEach((index, step) => left.addNote({ midi: chord[index],
      ticks: start + step * ppq / 2, durationTicks: ppq * 0.46,
      velocity: 0.36 + swell + (step === 0 ? 0.08 : 0) + step * 0.007 }));
    [0, 1, 1.5, 2.5].forEach((beat, step) => right.addNote({
      midi: bar === 23 && step === 3 ? 69 : phrase[step], ticks: start + beat * ppq,
      durationTicks: ppq * (step === 0 ? 0.93 : step === 2 ? 0.87 : 0.43),
      velocity: 0.57 + swell + (step === 0 ? 0.09 : 0) - step * 0.018,
    }));
    right.addCC({ number: 64, ticks: start + 24, value: 1 });
    right.addCC({ number: 64, ticks: start + 3 * ppq - 28, value: 0 });
  }
  return midi;
}
