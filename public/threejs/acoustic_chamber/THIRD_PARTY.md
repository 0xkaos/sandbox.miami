# Third-party code

Three.js **0.160.0**, MIT license, by the Three.js authors:

- `vendor/three.module.js` — unmodified [three.module.js](https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js).
- `vendor/OrbitControls.js` — unmodified [OrbitControls.js](https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js).
- `vendor/THREE.LICENSE` — the upstream [MIT license](https://github.com/mrdoob/three.js/blob/r160/LICENSE).

The import map resolves OrbitControls' `three` import to the local bundled module. No CDN is contacted at runtime.
