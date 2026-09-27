# Field Studio

Open `/threejs/acoustic_field/`. The example is a real captured harmonic field, so no live simulation or cloud connection is needed to explore the renderer. Three.js and OrbitControls are reused from the chamber's local vendor directory; see its [dependency notices](../acoustic_chamber/THIRD_PARTY.md).

For an evolving mist field without particles, open [Living Mist](../acoustic_mist/README.md) at `/threejs/acoustic_mist/`. Its captures open here with the mist view and camera preserved.

## Capture and render

In **Resonant Chamber**, give a field an optional name and choose **Capture & render**. The simulation pauses, copies the full-precision field inside its worker, saves it in IndexedDB, and opens Field Studio. The renderer uses the averaged squared-pressure field, not the display's quantized texture or a reconstruction from particle positions.

- **Contour curves:** marching squares on parallel slices, with a saddle decider and joined endpoints, produces continuous polylines. Parallel-transport tube frames give them adjustable physical thickness.
- **Curves along shells:** seeds are distributed by triangle area on each isosurface. A projected tangent direction, with adjustable swirl, advances each strand in both directions. Each step is projected back to the energy level; paths stop at boundaries or poorly defined gradients. These are artistic surface curves, not acoustic velocity streamlines.
- **Surface membranes:** consistent marching tetrahedra extracts each energy level, with normals interpolated from the field gradient. Transparent membranes provide a preview; overlapping transparency is approximate and is not a path-traced material.
- **Volume mist:** a ray marcher samples soft energy bands in a 3D texture, accumulating their colors and opacity. The GPU preview uses half-float values; saved samples retain their original float32 precision.

All modes share three independently adjustable levels and colors. Levels are multiples of the interior's mean energy. The pearl level defaults to 0.06 rather than zero, forming a small shell around quiet minima. Its surface is not the exact settled pearl particle distribution. Smoothing is mask-aware and affects only the preview. Curved chamber walls and the outlet's exterior are excluded using the saved domain mask. Geometry stops at the sampled chamber boundary; cutaways do not add caps.

Geometry builds in a worker, replaced when another build is requested. Drawing stops when the view is stationary. The original simulation's grid limits detail; smoothing or more triangles cannot recover unresolved physical structure.

## Saving

Captures and subsequent view edits are stored in this browser. **Download field** preserves a portable `.acfield` file, and **Import file** opens it elsewhere. Browser storage can be cleared by the browser; use a file or R2 for a durable copy.

**Save to R2** writes an immutable snapshot that includes the field, current name, colors, rendering controls, and camera. **Copy link** opens that exact saved version in another browser. Later local edits do not change the cloud version; save again to publish a new version. The library lists cloud saves newest first and supports pagination. Cloud reads are public, like the rest of this private project; writes use the site's `ADMIN_PASSWORD` through an `x-admin-password` header. Passwords are not stored in IndexedDB, URLs, or snapshots.

Both the Pages Function (`functions/api/acoustic-states/index.js`) and the Worker entry point use `lib/acoustic-states.mjs`:

- `GET /api/acoustic-states[?cursor=…]` lists up to 50 objects, including name, capture time, ID, size, and the next cursor.
- `GET /api/acoustic-states?id=…` retrieves an immutable binary snapshot.
- `POST /api/acoustic-states` accepts a validated binary snapshot with `Content-Type: application/octet-stream`; success returns its new ID.

Deployment needs the existing **BUCKET** R2 binding and **ADMIN_PASSWORD** environment secret. There is no fallback password for this endpoint. Missing cloud configuration or an upload failure leaves local captures available. Keys are isolated under `acoustic-states/v1/`; no existing objects are overwritten. Each request is limited to 16 MiB, dimensions are bounded, and float samples and payload length are validated before storage or rendering.

## Snapshot v1

The format has an 8-byte ASCII magic `ACFLD001`, a little-endian uint32 JSON byte length, UTF-8 metadata padded to a 4-byte boundary, then contiguous arrays: float32 averaged squared pressure, float32 instantaneous pressure, and uint8 mask. Floats use little-endian encoding. Mask values are 0 (solid), 1 (chamber), 2 (outlet/exterior). X varies fastest. `min`/`max` describe voxel edges; samples lie at `min + (index + 0.5) * cell`.

Metadata records format/version, name/date, chamber/source configuration including harmonic weights, grid dimensions and spacing, bounds, physical simulation time, mean energy, default shell levels, and optional renderer view. The API stores these bytes unchanged. This is a render snapshot, not a solver checkpoint: previous pressure, source phase, particle state, and pending solver time are not saved. SDF baking and Blender export are intentionally left for later; the original scalar field remains available for both.

## Validation

```sh
node --test scripts/test-acoustic-chamber.mjs scripts/test-acoustic-fields.mjs
npm run build
```

The field tests check lossless float round trips, corrupt payload rejection, closed contours, a known spherical surface and its normals, strand projection error, mask-aware smoothing, silence, and R2 save/list/reload and authorization behavior. Browser validation covers all four shader/geometry modes, capture, local reload, portable files, R2 through Wrangler's local emulator, a fresh browser opening a saved link, and mobile layout.

`node scripts/generate-acoustic-example.mjs` regenerates the bundled example from the current solver (fine resolution, 138 Hz with harmonics, 96% wall return, 2,000 steps). It is not part of the normal build.
