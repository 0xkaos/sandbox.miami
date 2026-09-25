# Resonant Chamber

Open `/threejs/acoustic_chamber/` for a silent, interactive study of three-dimensional acoustic interference and spatial cymatics. Everything runs locally in the browser; WebGL 2 is required. There are no external runtime requests.

## Exploring

- Drag to orbit and scroll or pinch to zoom. Hide the controls for an unobstructed view.
- The horn is a sparse wireframe. **Show horn wireframe** toggles its visibility while sound emission continues. There are no floating scene labels.
- **Multiple frequencies** adds harmonics at 2×, 3×, and 4× the fundamental, each with its own level. Set a level to 0% to remove that tone. The fundamental is automatically lowered when necessary to keep every enabled harmonic within the grid's frequency limit; the panel lists the active frequencies. At the default size and detail, enabling all four tones changes 240 Hz to a 105 Hz fundamental, giving 105 / 210 / 315 / 420 Hz. Switching modes or adjusting the mix keeps the current wave field and particle positions.
- Amber shows compression and blue shows rarefaction. Leave the continuous source running to let a particle pattern develop; **Particles only** reveals its structure.
- The default 48,000 fine points can be increased to 500,000, with a separate **Point size** slider. Three populations trace neighboring pressure-energy bands: pearl seeks quiet nodes, cyan seeks a low-energy contour, and rose seeks a slightly higher contour. **Quiet nodes · color by energy** restores the original motion for all particles and changes their colors with the local field instead. Switching modes preserves the current field and particle positions.
- Adjust frequency, amplitude, wall return, and particle response while running. Wall return covers 0–100% in 0.1% steps. A stronger return gives more persistent interference: 90% per reflection retains 81% pressure amplitude after two normal-incidence reflections; 99.5% retains about 99%, before other losses.
- At **100% wall return**, the walls absorb no energy. The existing gentle loss in the medium remains, and an open outlet still lets sound escape. A burst therefore rings for much longer, but this is not a completely lossless chamber. **Send a burst** is useful for exploring this limit.
- **Send a burst** emits a smooth three-cycle pulse, useful for watching arrivals, reflections, and decay. Continuous excitation keeps supplying new energy even when individual reflections fade quickly.
- Open the circular outlet opposite the horn to change the reflected field and see sound propagate outside. The size of the change depends on outlet diameter, wavelength, and wall return; a small hole will not necessarily transform the whole pattern.
- Rectangular, elliptical-cylinder, and tapered chambers have independent length, height, and depth controls. Geometry changes restart the field. **Restart field** clears it at any time; **Redistribute particles** keeps the current wave field.
- Wave motion is slowed by 50–200×. Particle motion is deliberately accelerated and follows display time. On slower devices, reduce particle count, use **Light** field detail, or choose **Particles only**. Heavy load can slow simulation time further to preserve numerical stability.

## Acoustic model and limits

`physics.mjs` solves the scalar 3D wave equation on an isotropic, six-neighbor finite-difference grid in a dedicated module worker. Sound speed is 343 m/s. The time step uses a Courant number of 0.48, below the three-dimensional stability limit of 1/√3. The frequency slider is limited to wavelengths of at least nine cells; this reduces numerical dispersion but does not make the result an engineering-grade prediction.

The horn drives a radially tapered circular patch of the left wall with the time derivative of a sinusoidal velocity source. Its visible flare is decorative: propagation within the horn itself is not simulated. Bursts use a three-cycle Hann envelope. A small bulk loss and passive, centered-in-time wall damping remove energy. The wall's normalized admittance is approximated by `(1 − R) / (1 + R)`, where R is the selected normal-incidence pressure reflection coefficient. Return varies with angle and grid resolution.

In multifrequency mode, the source velocity is a sum of phase-coherent sine waves at integer multiples of the fundamental. Relative levels (1 for the fundamental, then the three overtone controls) are divided by their sum, so enabling more tones does not simply multiply the maximum source drive. These are source-velocity weights, not measured pressure levels. Their velocity derivatives are summed once per acoustic step and injected into the same grid. There is still one wave solve, one energy field, and one particle cloud; only the source calculation adds a few sine/cosine evaluations. All tones share the same ramp or burst envelope, with a burst lasting three fundamental cycles. The pressure-energy average uses the combined field, preserving interference between tones.

At `R = 1`, the wall admittance is zero; there is no singularity in the time-stepping equations. Each update advances the field by a finite time step rather than summing an infinite list of echoes. In an ideal closed chamber with all losses removed, a finite burst would keep circulating without losing energy; a continuous source coupled to an exact resonance could keep adding energy without a finite steady-state limit. The simulation retains its small bulk damping term of `0.00012` at every wall-return setting. See [COMSOL's enclosed-source resonance example](https://www.comsol.com/blogs/how-to-model-fundamental-sources-in-enclosed-spaces) for the distinction between resonant and reverberant behavior.

An enabled outlet is an actual opening in the grid's end wall, connected to an exterior region with gradually increasing absorption and lossy outer boundaries. This finite absorbing region is an approximation to open air, not a perfectly matched layer or an exact radiation impedance. Curved surfaces, the aperture, and dimensions are voxel approximations; low detail changes their effective geometry. Pressure is displayed using a ray-marched 3D texture or a central pressure section.

Particles use the exponentially averaged pressure-energy field `E = ⟨p²⟩`, with a two-cycle time constant, drag, and capped acceleration. Pearl particles follow `−∇E`. In three-band mode, cyan and rose particles seek contours at 0.18 and 0.55 times the chamber's mean energy by following a scaled, capped `−(E − target)∇E` force. The targets move with the field. In quiet-node mode, every particle follows `−∇E`; colors indicate local energy ranges below 0.09, from 0.09 to 0.365, and above 0.365 times the mean (with a small normalization floor near silence).

Particle response is exaggerated and normalized for legibility. The colored populations are field tracers, not different physical materials. The model does not solve the full acoustic radiation force, fluid streaming, material contrast, gravity, or particle collisions. Escaping particles are recycled into the chamber. A pressure node is a region of small pressure oscillation, not permanently low-density air. Dimensions and frequencies have physical units; pressure, source amplitude, and particle response are relative.

This is a qualitative sketch for exploring patterns, not a calibrated loudspeaker-box, levitation, or room-acoustics design tool.

Background references: [COMSOL on acoustic radiation force](https://www.comsol.com/blogs/how-to-compute-the-acoustic-radiation-force), [locally reacting impedance boundaries](https://doc.comsol.com/6.4/doc/com.comsol.help.aco/aco_ug_pressure.05.113.html), and [local versus extended boundary reaction](https://www.comsol.com/blogs/sound-absorbing-boundaries-local-vs-extended-reaction).

## Validation and build

```sh
node --test scripts/test-acoustic-chamber.mjs
npm run build
npm run dev
```

Numerical checks cover stability, amplitude scaling, burst decay, outlet transmission, geometry/frequency effects, and particle attraction to a known potential. The normal project build adds the sketch to the front-page manifest; Cloudflare Pages serves these static files directly.

See [THIRD_PARTY.md](THIRD_PARTY.md) for bundled dependencies.
