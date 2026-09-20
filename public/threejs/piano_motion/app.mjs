import { GrandPiano } from './piano.mjs';
import { compilePerformance, createDemo, lowerBound, trackOptions, validateMidi } from './performance.mjs';

const $ = id => document.getElementById(id);
const Midi = window.Midi;
if (typeof Midi !== 'function') throw new Error('MIDI reader did not load.');
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const piano = new GrandPiano(state => {
  $('play-label').textContent = state === 'playing' ? 'Pause' : 'Play';
  $('play-icon').textContent = state === 'playing' ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', state === 'playing' ? 'Pause performance' : 'Play performance');
  $('playback-caption').textContent = state === 'playing' ? 'Listen to the space between notes' : state === 'ended' ? 'A moment of quiet' : 'Ready when you are';
  if (state === 'interrupted') status('Playback paused after a browser interruption. Press Play to continue.');
});
let midi, performance, selected = new Set(), scene;
let ready = false, loading = false, loadController, revision = 0, importing = 0;
let title = 'After the rain', isDemo = true;

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function invalidate() {
  revision++;
  loadController?.abort();
  loadController = null;
  loading = false;
  piano.pause();
  ready = false;
  $('play').disabled = !performance?.notes.length;
}

function rebuild(preservePosition = false) {
  const position = preservePosition ? piano.time : 0;
  invalidate();
  try {
    performance = compilePerformance(midi, selected, Number($('expression').value) / 100);
    piano.performance = performance;
    piano.position = Math.min(position, performance.duration);
    scene?.setPerformance(performance);
    $('track-count').textContent = `${selected.size} selected`;
    $('play').disabled = !performance.notes.length;
    $('duration').textContent = clock(performance.duration);
    const meter = midi.header.timeSignatures[0]?.timeSignature || [4, 4];
    $('piece-meta').textContent = `${isDemo ? 'Original piano study' : `${performance.notes.length.toLocaleString()} notes`} · ${meter.join('/')} · ${Math.round(midi.header.tempos[0]?.bpm || 120)} BPM`;
    $('piece-title').textContent = title;
    status(performance.notes.length ? 'Press Play to load the grand piano. Headphones welcome.' : 'Select at least one track to play.');
  } catch (error) {
    performance = null;
    $('play').disabled = true;
    status(error.message, true);
  }
}

function loadMidi(nextMidi, name, demo = false) {
  const options = trackOptions(nextMidi);
  if (!options.length) throw new Error('This MIDI has no playable notes. Try another file.');
  const preferred = options.some(track => track.piano) ? options.filter(track => track.piano) : options.filter(track => !track.percussion);
  const nextSelected = new Set((preferred.length ? preferred : options).map(track => track.id));
  // Validate before replacing the current playable study.
  compilePerformance(nextMidi, nextSelected);
  midi = nextMidi; selected = nextSelected; title = name; isDemo = demo;
  $('track-list').replaceChildren();
  for (const track of options) {
    const label = document.createElement('label'); label.className = 'track-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = selected.has(track.id);
    const text = document.createElement('span'); text.textContent = track.name;
    const detail = document.createElement('small');
    detail.textContent = `${track.instrument} · ${track.count.toLocaleString()} notes`;
    text.append(detail); label.append(checkbox, text); $('track-list').append(label);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(track.id); else selected.delete(track.id);
      rebuild();
    });
  }
  rebuild();
}

async function importFile(file) {
  if (!file) return;
  const request = ++importing;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a MIDI file smaller than 8 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (request !== importing) return;
    validateMidi(bytes);
    const next = new Midi(bytes);
    loadMidi(next, next.name?.trim() || file.name.replace(/\.midi?$/i, ''));
  } catch (error) { if (request === importing) status(error.message || 'This MIDI could not be read. Try exporting it again.', true); }
}

async function togglePlay() {
  if (piano.playing) { piano.pause(); status('Paused. Press Play to continue.'); return; }
  if (loading || !performance?.notes.length) return;
  const currentRevision = revision;
  const controller = new AbortController();
  loadController = controller;
  loading = true;
  $('play').disabled = true;
  try {
    await piano.unlock();
    if (currentRevision !== revision) return;
    if (!ready) {
      $('play-label').textContent = 'Loading…';
      await piano.load(performance, Number($('quality').value), (completed, total) => {
        if (currentRevision === revision) status(`Loading the grand piano · ${completed} / ${total} samples. First listen takes a little longer.`);
      }, controller.signal);
      if (currentRevision !== revision) return;
      ready = true;
    }
    // A long first download may allow the device to suspend the context.
    await piano.unlock();
    if (currentRevision !== revision) return;
    if (document.hidden) {
      $('play-label').textContent = 'Play';
      status('Piano loaded. Return to this tab and press Play to listen.');
      return;
    }
    piano.play();
    status(`Salamander grand · ${piano.layers} velocity layers · original sustain${Number($('expression').value) ? ' · humanize on' : ''}`);
  } catch (error) {
    if (currentRevision === revision) {
      status(error.message, true);
      $('play-label').textContent = 'Retry';
    }
  } finally {
    if (currentRevision === revision) { loading = false; $('play').disabled = !performance?.notes.length; }
  }
}

$('play').addEventListener('click', togglePlay);
$('upload').addEventListener('click', () => $('midi-file').click());
$('midi-file').addEventListener('change', event => { importFile(event.target.files[0]); event.target.value = ''; });
$('demo').addEventListener('click', () => { importing++; loadMidi(createDemo(Midi), 'After the rain', true); });
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([midi.toArray()], { type: 'audio/midi' }));
  const link = document.createElement('a'); link.href = url;
  link.download = `${title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'performance'}.mid`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('restart').addEventListener('click', () => piano.seek(0));
$('seek').addEventListener('input', () => piano.seek(Number($('seek').value) / 1000 * (performance?.duration || 0)));
$('speed').addEventListener('change', () => piano.setSpeed(Number($('speed').value)));
$('quality').addEventListener('change', () => { invalidate(); status('Touch detail changed. Press Play to load the new samples.'); });
$('expression').addEventListener('input', () => { $('expression-value').textContent = Number($('expression').value) ? `${$('expression').value}%` : 'Original MIDI'; });
$('expression').addEventListener('change', () => rebuild(true));
for (const id of ['room', 'mechanics', 'volume']) {
  $(id).addEventListener('input', () => {
    piano[id] = Number($(id).value) / 100;
    if ($(id + '-value')) $(id + '-value').textContent = `${$(id).value}%`;
    piano.setMix();
  });
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  if (scene) scene.view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => {
    item.classList.toggle('selected', item === button);
    item.setAttribute('aria-pressed', String(item === button));
  });
}));
$('ball-toggle').addEventListener('click', () => {
  const show = $('ball-toggle').getAttribute('aria-pressed') !== 'true';
  $('ball-toggle').setAttribute('aria-pressed', String(show));
  if (scene) scene.showBall = show;
  $('ball-toggle').textContent = `${show ? '●' : '○'} Bouncing guide`;
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY', 'A'].includes(event.target.tagName)) return;
  event.preventDefault(); togglePlay();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && piano.playing) { piano.pause(); status('Paused while the tab is hidden. Press Play to continue.'); }
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop-overlay').hidden = true; });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true; importFile(event.dataTransfer.files[0]); });

loadMidi(createDemo(Midi), 'After the rain', true);
try {
  const { ScoreScene } = await import('./scene.mjs');
  await document.fonts.load('100px Bravura');
  scene = new ScoreScene($('scene'));
  scene.setPerformance(performance);
  $('scene').addEventListener('scene-lost', () => {
    $('scene-error').hidden = false;
    $('scene-error').textContent = 'The 3D view was interrupted. Reload to restore it. Piano playback is still available.';
  });
} catch (error) {
  console.error(error);
  $('scene-error').hidden = false;
  $('scene-error').textContent = 'The 3D view needs WebGL and a connection to the graphics library. You can still listen to the piano.';
}

let lastFrame = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if (document.hidden || !performance) return;
  const delta = Math.min(0.1, (now - lastFrame) / 1000 || 0.016);
  lastFrame = now;
  const time = piano.time;
  scene?.draw(time, delta);
  $('current-time').textContent = clock(time);
  $('seek').value = String(Math.round(time / performance.duration * 1000));
  const down = [...performance.intervals.values()].some(spans => {
    const span = spans[lowerBound(spans, time + 1e-7) - 1];
    return span && time < span.end;
  });
  $('pedal-status').classList.toggle('down', down && piano.playing);
}
requestAnimationFrame(animate);
