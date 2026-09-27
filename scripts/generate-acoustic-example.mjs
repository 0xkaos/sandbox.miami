import { writeFile } from 'node:fs/promises';
import { WaveChamber } from '../public/threejs/acoustic_chamber/physics.mjs';
import { captureField, encodeSnapshot } from '../public/threejs/acoustic_chamber/snapshot.mjs';

// An actual solver capture, bundled so Field Studio is useful before a first save.
const field = new WaveChamber({ resolution:56, frequency:138, reflection:0.96, harmonics:true });
field.step(2000);
const snapshot = captureField(field,'Harmonic chamber');
await writeFile(new URL('../public/threejs/acoustic_field/example.acfield',import.meta.url),new Uint8Array(encodeSnapshot(snapshot)));
console.log(`Captured ${field.size} samples at ${field.time.toFixed(3)} seconds.`);
