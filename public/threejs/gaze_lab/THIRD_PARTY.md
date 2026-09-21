# Third-party assets

## MediaPipe

Copyright The MediaPipe Authors / Google LLC. Licensed under the Apache License, Version 2.0; see [LICENSE](vendor/mediapipe/LICENSE).

Unmodified browser runtime and WebAssembly assets copied from the published `@mediapipe/tasks-vision@1.0.1` package:

- Package: <https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1>
- Archive: <https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.0.1.tgz>
- Package integrity: `sha512-rvRE2FmAZ6ZxKSw7wq+e+jQDpN3t1B/tD2mJz9SmAzb1msoDkd4dMoE4wAh8Z30Um0PQwLiHr9QtomhmXk3aUQ==`
- Source: <https://github.com/google-ai-edge/mediapipe>

The included files are `vision_bundle.js`, and the SIMD and non-SIMD `vision_wasm_*` JavaScript loaders and WASM binaries. Module-worker variants and source maps are not needed by this classic-worker implementation and are omitted.

The unmodified float16 Face Landmarker task bundle, version **1**, comes from Google's published MediaPipe models:

- Model: <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
- Documentation: <https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker>
- Face mesh model card and Apache 2.0 license: <https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf>

The sketch's calibration, regression, validation, visualization, and interface code are part of this repository and retain its MIT license.
