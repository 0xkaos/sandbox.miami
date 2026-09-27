# Living Mist

Open `/threejs/acoustic_mist/` for a live version of Field Studio's volume mist. The wave equation runs continuously, and three adjustable energy bands become soft colored shells. No particles are created or advanced. The initial chamber uses the same fine-resolution, 138 Hz harmonic source and 96% wall return as the Studio example, with wave motion slowed by 50×.

## Exploring

- Change frequency, amplitude, wall return, or the harmonic mix while the field is running. These preserve the waves already in the chamber. The source retains the chamber's grid-dependent frequency limits and normalized harmonic weights.
- **Send a burst** emits three cycles and lets the field decay. At 100% wall return, the solver still includes gentle loss in the medium; an open outlet also allows energy to escape.
- Mist brightness follows the square root of mean pressure energy relative to its highest value since restart (with a small floor near silence). This lets bursts and reduced amplitude fade instead of continuously amplifying a dying field through normalization. Restart resets this brightness reference.
- **Pause** freezes wave time while orbit, color, band softness, density, smoothing, layer levels, and cutaways remain adjustable. Pausing also stops drawing once the camera and controls are idle.
- Shape, dimensions, outlet geometry, and **Field detail** rebuild the chamber. These changes clear the wave field; pause state is retained.
- **Render quality** changes ray samples and canvas resolution independently of the acoustic grid: Light uses 96 ray samples and up to 0.8 pixels per CSS pixel, Balanced uses 144 / 1.25, and Fine uses 224 / 1.5. Small screens start on Light. All modes target at most 30 visual updates per second.
- **Capture in Studio** pauses, waits for the outstanding frame, and saves the raw float32 energy/pressure field plus camera, colors, and mist controls. It opens Field Studio in mist mode. Its existing R2, download, and alternate rendering workflows remain available. The wireframe horn is a live-sketch guide and is not part of the captured volume.

This is a live visualization with deliberately slowed sound propagation, not audio-rate simulation or audio playback. Expensive frames may slow physical time further rather than accumulating an unlimited catch-up queue. See the [chamber's model description](../acoustic_chamber/README.md) for the underlying acoustics and qualitative limits.

## Implementation

`model.mjs` wraps the existing `WaveChamber` solver. Each update computes mean energy, normalizes it, and optionally performs the same mask-aware smoothing as Field Studio. It uses the solver's precomputed neighbors and reusable scratch arrays. The regular update path omits particle gradients, particle integration, particle colors, and particle buffer copies.

`simulation.mjs` transfers one float32 grid per frame. The main thread returns that buffer with its next request, maintains one persistent half-float GPU texture, and sends at most one outstanding frame request. The domain mask is sent only when rebuilding the chamber. A default fine field transfers about 415 KiB per update; the old 500,000-particle path at that grid size transfers about 7.6 MiB. These are transfer sizes, not total memory use.

The new sketch uses the existing mist shader with configurable ray samples. Field Studio retains its 176-sample default. Mean-energy normalization, smoothing, and cell-centered coordinates match Studio; captures retain unsmoothed float32 data. When capturing a nearly invisible field, Studio's opacity slider has a 5% lower limit.

Live drawing adds both wave computation and GPU work compared with a stationary snapshot. Performance depends on the device, canvas size, field detail, and ray quality. The rendering loop sleeps between changes while paused and stops submitting simulation work in a background tab. Returning to a hidden tab does not attempt to simulate the missed time.

Three.js and OrbitControls are reused from the chamber's local vendor directory. See its [third-party notices](../acoustic_chamber/THIRD_PARTY.md). There are no new runtime dependencies or cloud requests until opening Studio's storage workflow.

## Checks

```sh
node --test scripts/test-acoustic-mist.mjs scripts/test-acoustic-fields.mjs
npm run build
```

Tests compare the live solver against the original wave equation, compare every smoothing level used in the checks against Studio for all chamber shapes, verify zero-signal invisibility and burst fading, preserve paused time during appearance changes, check bounded catch-up and harmonic limits, and round-trip captured fields and view settings. Browser checks exercise live updates, pause/resume, quality modes, cutaways, all chamber shapes, the outlet, burst decay, capture into Studio, and mobile layout.
